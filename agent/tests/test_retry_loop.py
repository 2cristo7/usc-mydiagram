"""S6.5c — Regeneración de aristas huérfanas con feedback.

Cubre las tres piezas del bucle de retry:
  - validate: decide reintentar (hay huérfanas + presupuesto) o rendirse (descartar).
  - route_after_validate: traduce esa decisión en volver a extract_edges o terminar.
  - extract_edges (modo feedback): regenera SOLO las huérfanas, streamea las arregladas
    y no re-streamea las ya confirmadas.
"""
import asyncio
import pytest
from unittest.mock import patch

from schemas import DiagramNode, DiagramEdge, DiagramSchema, NodeType, EdgeType, DiagramType
from nodes.validate import validate, MAX_RETRIES
from nodes.extract_edges import make_extract_edges
from graph import route_after_validate
from langgraph.graph import END


def _node(id_):
    return DiagramNode(id=id_, label=id_.title(), node_type=NodeType.TABLE, attributes=[])


def _edge(id_, source, target):
    return DiagramEdge(id=id_, source=source, target=target, label="rel", edge_type=EdgeType.ONE_TO_MANY)


def _base_state(**overrides):
    state = {
        "prompt": "un usuario hace pedidos",
        "is_diagram_request": True,
        "diagram_type": DiagramType.ERD,
        "nodes": [_node("user"), _node("order")],
        "edges": [],
        "orphan_edges": [],
        "diagram": None,
        "validation_errors": [],
        "retry_count": 0,
        "title": "Pedidos",
    }
    state.update(overrides)
    return state


# ---------- validate ----------

@pytest.mark.asyncio
async def test_validate_retries_when_orphans_and_budget():
    orphan = _edge("e1", "usr", "order")  # 'usr' no existe → huérfana
    state = _base_state(orphan_edges=[orphan], diagram=DiagramSchema(
        title="t", diagram_type=DiagramType.ERD, nodes=[_node("user"), _node("order")], edges=[]), retry_count=0)

    result = await validate(state)

    assert result["validation_errors"], "debe producir feedback para reintentar"
    assert "e1" in result["validation_errors"][0]
    assert result["retry_count"] == 1, "incrementa el contador de reintentos"


@pytest.mark.asyncio
async def test_validate_gives_up_when_budget_exhausted():
    orphan = _edge("e1", "usr", "order")
    state = _base_state(orphan_edges=[orphan], diagram=DiagramSchema(
        title="t", diagram_type=DiagramType.ERD, nodes=[_node("user"), _node("order")], edges=[]),
        retry_count=MAX_RETRIES)

    result = await validate(state)

    assert result["validation_errors"] == [], "agotado el presupuesto → no reintenta (descarta)"
    assert "retry_count" not in result, "no toca el contador al rendirse"


@pytest.mark.asyncio
async def test_validate_passes_when_no_orphans():
    state = _base_state(orphan_edges=[], diagram=DiagramSchema(
        title="t", diagram_type=DiagramType.ERD, nodes=[_node("user")], edges=[]))

    result = await validate(state)

    assert result["validation_errors"] == []


# ---------- route_after_validate ----------

def test_route_back_to_extract_edges_on_errors():
    state = _base_state(validation_errors=["edge e1 references non-existent node"])
    assert route_after_validate(state) == "extract_edges"


def test_route_ends_when_clean():
    state = _base_state(validation_errors=[])
    assert route_after_validate(state) == END


# ---------- extract_edges modo feedback ----------

async def _fake_stream(text):
    """Imita stream_llm: async generator que entrega el JSON en dos trozos."""
    mid = len(text) // 2
    for chunk in (text[:mid], text[mid:]):
        yield chunk


@pytest.mark.asyncio
async def test_extract_edges_normal_pass_retains_orphan_without_streaming():
    # Pasada normal (retry_count=0): la válida se streamea, la huérfana se retiene
    # (ni queue.put ni descarte) para que validate dispare el reintento.
    queue = asyncio.Queue()
    state = _base_state(retry_count=0)

    raw = '[{"id": "e0", "source": "user", "target": "order", "label": "places", "edge_type": "one_to_many"},' \
          ' {"id": "e1", "source": "usr", "target": "order", "label": "places", "edge_type": "one_to_many"}]'

    with patch("nodes.extract_edges.stream_llm", return_value=_fake_stream(raw)):
        extract_edges = make_extract_edges(queue)
        result = await extract_edges(state)

    assert [e.id for e in result["edges"]] == ["e0"], "solo la válida en edges"
    assert [e.id for e in result["orphan_edges"]] == ["e1"], "la huérfana retenida"

    streamed = []
    while not queue.empty():
        streamed.append(queue.get_nowait())
    assert [item["data"]["id"] for item in streamed] == ["e0"], "solo la válida llega al canvas"


@pytest.mark.asyncio
async def test_extract_edges_feedback_fixes_orphan_and_streams_it():
    # Estado de una pasada de feedback: e1 quedó huérfana ('usr'); ya hay una arista
    # válida confirmada (e0) que NO debe re-streamearse.
    queue = asyncio.Queue()
    orphan = _edge("e1", "usr", "order")
    confirmed = _edge("e0", "user", "order")
    state = _base_state(
        edges=[confirmed],          # ya streameada en pasada previa
        orphan_edges=[orphan],
        retry_count=1,              # > 0 → rama feedback
    )

    # El LLM corrige e1 (usr -> user) y, por error, re-emite e0 (debe ignorarse por dedup).
    fixed_json = '[{"id": "e1", "source": "user", "target": "order", "label": "places", "edge_type": "one_to_many"},' \
                 ' {"id": "e0", "source": "user", "target": "order", "label": "places", "edge_type": "one_to_many"}]'

    with patch("nodes.extract_edges.stream_llm", return_value=_fake_stream(fixed_json)):
        extract_edges = make_extract_edges(queue)
        result = await extract_edges(state)

    # e1 corregida vuelve como nueva (el reducer la sumará a e0)
    assert [e.id for e in result["edges"]] == ["e1"]
    assert result["edges"][0].source == "user"
    # ya no quedan huérfanas
    assert result["orphan_edges"] == []

    # Solo e1 se streamea; e0 (ya confirmada) se ignora por el guard anti-duplicados
    streamed = []
    while not queue.empty():
        streamed.append(queue.get_nowait())
    assert [item["data"]["id"] for item in streamed] == ["e1"]
    assert all(item["_type"] == "edge" for item in streamed)


@pytest.mark.asyncio
async def test_extract_edges_feedback_reholds_still_broken():
    # Si el "arreglo" sigue apuntando a un nodo inexistente, vuelve a orphan_edges.
    queue = asyncio.Queue()
    state = _base_state(orphan_edges=[_edge("e1", "usr", "order")], retry_count=1)

    still_broken = '[{"id": "e1", "source": "customer", "target": "order", "label": "x", "edge_type": "one_to_many"}]'

    with patch("nodes.extract_edges.stream_llm", return_value=_fake_stream(still_broken)):
        extract_edges = make_extract_edges(queue)
        result = await extract_edges(state)

    assert result["edges"] == [], "ninguna válida"
    assert [e.id for e in result["orphan_edges"]] == ["e1"], "sigue retenida para otro reintento"
    assert queue.empty(), "no se streamea nada roto"
