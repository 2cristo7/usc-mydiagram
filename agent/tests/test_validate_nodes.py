"""S6.7 — Bucle de retry de nodos.

extract_nodes retiene en invalid_nodes (dicts {raw, reason}) los nodos que fallan
validación Pydantic o validación semántica (node_type no permitido para el tipo),
sin streamearlos. validate_nodes decide reintentar o rendirse;
route_after_validate_nodes traduce la decisión (volver a extract_nodes o seguir a
extract_edges).
"""
import asyncio
import pytest
from unittest.mock import patch

from schemas import DiagramNode, NodeType, DiagramType
from nodes.validate_nodes import validate_nodes, MAX_NODE_RETRIES
from nodes.extract_nodes import make_extract_nodes
from graph import route_after_validate_nodes


def _node(id_, node_type=NodeType.TABLE):
    return DiagramNode(id=id_, label=id_.title(), node_type=node_type, attributes=[])


def _invalid(raw, reason):
    return {"raw": raw, "reason": reason}


def _base_state(**overrides):
    state = {
        "prompt": "un usuario hace pedidos",
        "is_diagram_request": True,
        "diagram_type": DiagramType.ERD,
        "nodes": [],
        "edges": [],
        "invalid_edges": [],
        "invalid_nodes": [],
        "diagram": None,
        "validation_errors": [],
        "retry_count": 0,
        "node_retry_count": 0,
        "node_validation_errors": [],
        "title": "Pedidos",
    }
    state.update(overrides)
    return state


async def _fake_stream(text):
    mid = len(text) // 2
    for chunk in (text[:mid], text[mid:]):
        yield chunk


# ---------- validate_nodes ----------

@pytest.mark.asyncio
async def test_validate_nodes_retries_when_invalid_and_budget():
    state = _base_state(
        invalid_nodes=[_invalid({"id": "n1", "node_type": "decision"},
                                'node_type "decision" no permitido en erd')],
        node_retry_count=0,
    )

    result = await validate_nodes(state)

    assert result["node_validation_errors"], "debe producir feedback para reintentar"
    assert "decision" in result["node_validation_errors"][0]
    assert result["node_retry_count"] == 1


@pytest.mark.asyncio
async def test_validate_nodes_gives_up_when_exhausted():
    state = _base_state(
        invalid_nodes=[_invalid({"id": "n1"}, "motivo")],
        node_retry_count=MAX_NODE_RETRIES,
    )

    result = await validate_nodes(state)

    assert result["node_validation_errors"] == [], "agotado → no reintenta (descarta)"
    assert "node_retry_count" not in result, "no toca el contador al rendirse"


@pytest.mark.asyncio
async def test_validate_nodes_passes_when_clean():
    state = _base_state(invalid_nodes=[])

    result = await validate_nodes(state)

    assert result["node_validation_errors"] == []


# ---------- route_after_validate_nodes ----------

def test_route_back_to_extract_nodes_on_errors():
    state = _base_state(node_validation_errors=['node_type "decision" no permitido en erd'])
    assert route_after_validate_nodes(state) == "extract_nodes"


def test_route_forward_to_extract_edges_when_clean():
    state = _base_state(node_validation_errors=[])
    assert route_after_validate_nodes(state) == "extract_edges"


# ---------- extract_nodes: pasada normal, dos clases de inválido ----------

@pytest.mark.asyncio
async def test_extract_nodes_normal_retains_semantic_invalid():
    # node_type 'decision' es Pydantic-válido pero NO permitido en un ERD.
    queue = asyncio.Queue()
    state = _base_state(diagram_type=DiagramType.ERD, node_retry_count=0)
    raw = '[{"id": "user", "label": "Usuario", "node_type": "table", "attributes": []},' \
          ' {"id": "bifurca", "label": "Bifurca", "node_type": "decision", "attributes": []}]'

    with patch("nodes.extract_nodes.stream_llm", return_value=_fake_stream(raw)):
        result = await make_extract_nodes(queue)(state)

    assert [n.id for n in result["nodes"]] == ["user"], "solo el válido"
    assert len(result["invalid_nodes"]) == 1
    assert result["invalid_nodes"][0]["raw"]["id"] == "bifurca"
    assert "no permitido" in result["invalid_nodes"][0]["reason"]
    streamed = [queue.get_nowait()["data"]["id"] for _ in range(queue.qsize())]
    assert streamed == ["user"], "solo el válido se streamea"


@pytest.mark.asyncio
async def test_extract_nodes_normal_retains_pydantic_invalid():
    # node_type 'tabla' no está en el enum NodeType → falla Pydantic.
    queue = asyncio.Queue()
    state = _base_state(node_retry_count=0)
    raw = '[{"id": "user", "label": "Usuario", "node_type": "tabla", "attributes": []}]'

    with patch("nodes.extract_nodes.stream_llm", return_value=_fake_stream(raw)):
        result = await make_extract_nodes(queue)(state)

    assert result["nodes"] == []
    assert len(result["invalid_nodes"]) == 1, "el fallo Pydantic NO se descarta en silencio"
    assert "schema inválido" in result["invalid_nodes"][0]["reason"]
    assert queue.empty()


# ---------- extract_nodes: pasada de feedback ----------

@pytest.mark.asyncio
async def test_extract_nodes_feedback_fixes_and_dedups():
    queue = asyncio.Queue()
    state = _base_state(
        nodes=[_node("user")],   # ya confirmado en pasada previa
        invalid_nodes=[_invalid({"id": "bifurca", "label": "Bifurca", "node_type": "decision", "attributes": []},
                                'node_type "decision" no permitido en erd')],
        node_retry_count=1,      # > 0 → rama feedback
    )
    # El LLM corrige bifurca (decision -> table) y re-emite user (debe ignorarse por dedup).
    fixed = '[{"id": "bifurca", "label": "Bifurca", "node_type": "table", "attributes": []},' \
            ' {"id": "user", "label": "Usuario", "node_type": "table", "attributes": []}]'

    with patch("nodes.extract_nodes.stream_llm", return_value=_fake_stream(fixed)):
        result = await make_extract_nodes(queue)(state)

    assert [n.id for n in result["nodes"]] == ["bifurca"], "solo el corregido vuelve (reducer suma)"
    assert result["invalid_nodes"] == []
    streamed = [queue.get_nowait()["data"]["id"] for _ in range(queue.qsize())]
    assert streamed == ["bifurca"], "user ya confirmado se ignora por dedup"
