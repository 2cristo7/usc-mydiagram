"""S6.5c + S6.7 — Bucle de retry de aristas con representación unificada.

extract_edges retiene en invalid_edges (dicts {raw, reason}) las TRES clases de
arista fallida: huérfana (referencia a nodo inexistente), semántica (edge_type no
permitido para el tipo) y Pydantic (schema inválido). validate_edges decide
reintentar o rendirse; route_after_validate_edges traduce la decisión.
"""
import asyncio
import pytest
from unittest.mock import patch

from schemas import DiagramNode, DiagramEdge, DiagramSchema, NodeType, EdgeType, DiagramType
from nodes.validate_edges import validate_edges, MAX_RETRIES
from nodes.extract_edges import make_extract_edges
from graph import route_after_validate_edges
from langgraph.graph import END


def _node(id_):
    return DiagramNode(id=id_, label=id_.title(), node_type=NodeType.TABLE, attributes=[])


def _edge(id_, source, target):
    return DiagramEdge(id=id_, source=source, target=target, label="rel", edge_type=EdgeType.ONE_TO_MANY)


def _invalid(raw, reason):
    return {"raw": raw, "reason": reason}


def _base_state(**overrides):
    state = {
        "prompt": "un usuario hace pedidos",
        "is_diagram_request": True,
        "diagram_type": DiagramType.ERD,
        "nodes": [_node("user"), _node("order")],
        "edges": [],
        "invalid_edges": [],
        "invalid_nodes": [],
        "diagram": None,
        "validation_errors": [],
        "edges_retry_count": 0,
        "node_retry_count": 0,
        "node_validation_errors": [],
        "structural_gaps": [],
        "schema_retry_count": 0,
        "title": "Pedidos",
    }
    state.update(overrides)
    return state


async def _fake_stream(text):
    """Imita stream_llm: async generator que entrega el JSON en dos trozos."""
    mid = len(text) // 2
    for chunk in (text[:mid], text[mid:]):
        yield chunk


# ---------- validate_edges ----------

@pytest.mark.asyncio
async def test_validate_retries_when_invalid_and_budget():
    state = _base_state(
        invalid_edges=[_invalid({"id": "e1", "source": "usr", "target": "order"},
                                'referencia a nodo inexistente: "usr" -> "order"')],
        edges_retry_count=0,
    )

    result = await validate_edges(state)

    assert result["validation_errors"], "debe producir feedback para reintentar"
    assert "usr" in result["validation_errors"][0]
    assert result["edges_retry_count"] == 1, "incrementa el contador de reintentos"


@pytest.mark.asyncio
async def test_validate_gives_up_when_budget_exhausted():
    state = _base_state(
        invalid_edges=[_invalid({"id": "e1"}, "motivo")],
        edges_retry_count=MAX_RETRIES,
    )

    result = await validate_edges(state)

    assert result["validation_errors"] == [], "agotado el presupuesto → no reintenta (descarta)"
    assert "edges_retry_count" not in result, "no toca el contador al rendirse"


@pytest.mark.asyncio
async def test_validate_passes_when_no_invalid():
    state = _base_state(invalid_edges=[])

    result = await validate_edges(state)

    assert result["validation_errors"] == []


# ---------- route_after_validate_edges ----------

def test_route_back_to_extract_edges_on_errors():
    state = _base_state(validation_errors=["edge e1 references non-existent node"])
    assert route_after_validate_edges(state) == "extract_edges"


def test_route_to_extract_fragments_when_clean():
    # S6.8 reordenó el grafo: validate_edges va ANTES de synthesize, así que
    # "limpio" ya no termina el grafo. S10.4 insertó extract_fragments entre
    # validate_edges y synthesize (no-op salvo en secuencia): tras validar las
    # aristas, el router pasa por la extracción de fragmentos antes de ensamblar.
    state = _base_state(validation_errors=[])
    assert route_after_validate_edges(state) == "extract_fragments"


# ---------- extract_edges: pasada normal, tres clases de inválida ----------

@pytest.mark.asyncio
async def test_extract_edges_normal_retains_orphan():
    queue = asyncio.Queue()
    state = _base_state(edges_retry_count=0)
    raw = '[{"id": "e0", "source": "user", "target": "order", "label": "p", "edge_type": "one_to_many"},' \
          ' {"id": "e1", "source": "usr", "target": "order", "label": "p", "edge_type": "one_to_many"}]'

    with patch("nodes.extract_edges.stream_llm", return_value=_fake_stream(raw)):
        result = await make_extract_edges(queue)(state)

    assert [e.id for e in result["edges"]] == ["e0"], "solo la válida en edges"
    assert len(result["invalid_edges"]) == 1
    assert result["invalid_edges"][0]["raw"]["id"] == "e1"
    assert "inexistente" in result["invalid_edges"][0]["reason"]
    streamed = [queue.get_nowait()["data"]["id"] for _ in range(queue.qsize())]
    assert streamed == ["e0"], "solo la válida llega al canvas"


@pytest.mark.asyncio
async def test_extract_edges_normal_retains_semantic_invalid():
    # edge_type 'flow' es Pydantic-válido (está en el enum) pero NO permitido en un ERD.
    queue = asyncio.Queue()
    state = _base_state(edges_retry_count=0)
    raw = '[{"id": "e1", "source": "user", "target": "order", "label": "x", "edge_type": "flow"}]'

    with patch("nodes.extract_edges.stream_llm", return_value=_fake_stream(raw)):
        result = await make_extract_edges(queue)(state)

    assert result["edges"] == [], "no se confirma una semánticamente inválida"
    assert len(result["invalid_edges"]) == 1
    assert "flow" in result["invalid_edges"][0]["reason"]
    assert "no permitido" in result["invalid_edges"][0]["reason"]
    assert queue.empty(), "no se streamea lo semánticamente inválido"


@pytest.mark.asyncio
async def test_extract_edges_normal_retains_pydantic_invalid():
    # edge_type 'relates_to' NO está en el enum EdgeType → falla Pydantic.
    queue = asyncio.Queue()
    state = _base_state(edges_retry_count=0)
    raw = '[{"id": "e1", "source": "user", "target": "order", "label": "x", "edge_type": "relates_to"}]'

    with patch("nodes.extract_edges.stream_llm", return_value=_fake_stream(raw)):
        result = await make_extract_edges(queue)(state)

    assert result["edges"] == []
    assert len(result["invalid_edges"]) == 1, "el fallo Pydantic NO se descarta en silencio"
    assert "schema inválido" in result["invalid_edges"][0]["reason"]
    assert queue.empty()


# ---------- extract_edges: pasada de feedback ----------

@pytest.mark.asyncio
async def test_extract_edges_feedback_fixes_and_streams():
    queue = asyncio.Queue()
    state = _base_state(
        edges=[_edge("e0", "user", "order")],   # ya confirmada en pasada previa
        invalid_edges=[_invalid({"id": "e1", "source": "usr", "target": "order",
                                 "label": "p", "edge_type": "one_to_many"}, "huérfana")],
        edges_retry_count=1,                           # > 0 → rama feedback
    )
    # El LLM corrige e1 (usr -> user) y re-emite e0 (debe ignorarse por dedup).
    fixed = '[{"id": "e1", "source": "user", "target": "order", "label": "p", "edge_type": "one_to_many"},' \
            ' {"id": "e0", "source": "user", "target": "order", "label": "p", "edge_type": "one_to_many"}]'

    with patch("nodes.extract_edges.stream_llm", return_value=_fake_stream(fixed)):
        result = await make_extract_edges(queue)(state)

    assert [e.id for e in result["edges"]] == ["e1"]
    assert result["edges"][0].source == "user"
    assert result["invalid_edges"] == [], "ya no quedan inválidas"
    streamed = [queue.get_nowait()["data"]["id"] for _ in range(queue.qsize())]
    assert streamed == ["e1"], "e0 ya confirmada se ignora por dedup"


@pytest.mark.asyncio
async def test_extract_edges_truncated_registers_degradation():
    # JSON cortado a mitad de stream: ijson aborta. NO se rompe (se conserva lo
    # parseado), pero se registra una degradación de parseo (category "structure")
    # para que la respuesta truncada llegue al usuario en vez de un diagrama
    # silenciosamente parcial.
    queue = asyncio.Queue()
    state = _base_state(edges_retry_count=0)
    # Primera arista completa y válida; la segunda queda cortada (sin cerrar).
    truncated = '[{"id": "e0", "source": "user", "target": "order", "label": "p", "edge_type": "one_to_many"},' \
                ' {"id": "e1", "source": "user", "tar'

    with patch("nodes.extract_edges.stream_llm", return_value=_fake_stream(truncated)):
        result = await make_extract_edges(queue)(state)

    assert [e.id for e in result["edges"]] == ["e0"], "se conserva lo parseado antes del corte"
    assert "degradations" in result, "el truncado se registra como degradación"
    assert result["degradations"][0]["category"] == "structure"
    assert "truncada" in result["degradations"][0]["reasons"][0]


@pytest.mark.asyncio
async def test_extract_edges_feedback_reholds_still_broken():
    queue = asyncio.Queue()
    state = _base_state(
        invalid_edges=[_invalid({"id": "e1", "source": "usr", "target": "order",
                                 "label": "x", "edge_type": "one_to_many"}, "huérfana")],
        edges_retry_count=1,
    )
    still_broken = '[{"id": "e1", "source": "customer", "target": "order", "label": "x", "edge_type": "one_to_many"}]'

    with patch("nodes.extract_edges.stream_llm", return_value=_fake_stream(still_broken)):
        result = await make_extract_edges(queue)(state)

    assert result["edges"] == [], "ninguna válida"
    assert [item["raw"]["id"] for item in result["invalid_edges"]] == ["e1"], "sigue retenida"
    assert queue.empty(), "no se streamea nada roto"
