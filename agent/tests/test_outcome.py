"""S6.9 — Gestión integral de errores y degradación del grafo.

Cubre la taxonomía de desenlaces:
- classify_outcome: una categoría distinta y accionable por cada tipo de fallo
  (guard-reject, fallo total, excepción) y done limpio vs done+degradado;
- los branches de rendición (validate_nodes/edges/schema) registran su degradación
  en el canal `degradations` (que sobrevive al END) además de vaciar la señal de
  routing, con guarda de idempotencia.
"""
import pytest

from schemas import DiagramNode, DiagramSchema, NodeType, EdgeType, DiagramType, DiagramEdge
from outcome import classify_outcome, ERROR_MESSAGES
from nodes.validate_edges import validate_edges, MAX_RETRIES
from nodes.validate_nodes import validate_nodes, MAX_NODE_RETRIES
from nodes.validate_schema import validate_schema, MAX_SCHEMA_RETRIES


def _n(i, t=NodeType.STEP):
    return DiagramNode(id=i, label=i.title(), node_type=t, attributes=[])


def _diagram(nodes):
    return DiagramSchema(title="T", diagram_type=DiagramType.FLOWCHART, nodes=nodes, edges=[])


def _state(**overrides):
    state = {
        "prompt": "x",
        "is_diagram_request": True,
        "diagram_type": DiagramType.FLOWCHART,
        "nodes": [],
        "edges": [],
        "invalid_edges": [],
        "invalid_nodes": [],
        "diagram": None,
        "validation_errors": [],
        "retry_count": 0,
        "node_retry_count": 0,
        "node_validation_errors": [],
        "structural_gaps": [],
        "schema_retry_count": 0,
        "degradations": [],
        "title": "T",
    }
    state.update(overrides)
    return state


# ============================ A. classify_outcome ============================

def test_crash_is_internal_error():
    out = classify_outcome(None, crashed=True)
    assert out["_type"] == "error"
    assert out["category"] == "internal_error"
    assert out["message"] == ERROR_MESSAGES["internal_error"]


def test_none_state_is_internal_error():
    # Sin flag pero sin estado tampoco hay nada fiable que clasificar.
    assert classify_outcome(None)["category"] == "internal_error"


def test_guard_reject_is_not_a_diagram():
    out = classify_outcome(_state(is_diagram_request=False))
    assert out["_type"] == "error"
    assert out["category"] == "not_a_diagram"


def test_zero_nodes_is_empty_error():
    # synthesize SIEMPRE construye un DiagramSchema; el umbral done/error es ≥1 nodo.
    out = classify_outcome(_state(diagram=_diagram([])))
    assert out["_type"] == "error"
    assert out["category"] == "empty"


def test_no_diagram_object_is_empty_error():
    assert classify_outcome(_state(diagram=None))["category"] == "empty"


def test_one_node_clean_is_done_not_degraded():
    out = classify_outcome(_state(diagram=_diagram([_n("a")])))
    assert out["_type"] == "done"
    assert out["degraded"] is False
    assert out["degradations"] == []
    assert out["title"] == "T"


def test_degradations_make_done_degraded():
    degr = [{"category": "edges", "reasons": ["arista X huérfana"]}]
    out = classify_outcome(_state(diagram=_diagram([_n("a")]), degradations=degr))
    assert out["_type"] == "done"
    assert out["degraded"] is True
    assert out["degradations"] == degr


def test_every_error_category_has_a_distinct_message():
    msgs = set(ERROR_MESSAGES.values())
    assert len(msgs) == 3, "cada categoría de error con su mensaje propio"
    assert all(m.strip() for m in msgs)


# ============================ B. branches de rendición → degradations ============================

@pytest.mark.asyncio
async def test_validate_edges_records_degradation_on_giveup():
    invalid = [{"raw": {"id": "e1"}, "reason": "referencia a nodo inexistente"}]
    state = _state(invalid_edges=invalid, retry_count=MAX_RETRIES)

    result = await validate_edges(state)

    assert result["validation_errors"] == [], "vacía la señal de routing (corta el bucle)"
    assert result["degradations"] == [
        {"category": "edges", "reasons": ["referencia a nodo inexistente"]}
    ]


@pytest.mark.asyncio
async def test_validate_edges_no_degradation_while_budget_left():
    # Con presupuesto reintenta, no degrada: no debe tocar `degradations`.
    state = _state(invalid_edges=[{"raw": {}, "reason": "r"}], retry_count=0)
    result = await validate_edges(state)
    assert result["validation_errors"], "reintenta"
    assert "degradations" not in result


@pytest.mark.asyncio
async def test_validate_edges_giveup_is_idempotent():
    # Si el bucle estructural reentra por aquí ya agotado y con la categoría ya
    # registrada, no se duplica la entrada "edges".
    state = _state(
        invalid_edges=[{"raw": {}, "reason": "r"}],
        retry_count=MAX_RETRIES,
        degradations=[{"category": "edges", "reasons": ["previo"]}],
    )
    result = await validate_edges(state)
    assert result["validation_errors"] == []
    assert "degradations" not in result, "no re-añade su categoría"


@pytest.mark.asyncio
async def test_validate_nodes_records_degradation_on_giveup():
    invalid = [{"raw": {"id": "x"}, "reason": "node_type no permitido"}]
    state = _state(invalid_nodes=invalid, node_retry_count=MAX_NODE_RETRIES)

    result = await validate_nodes(state)

    assert result["node_validation_errors"] == []
    assert result["degradations"] == [
        {"category": "nodes", "reasons": ["node_type no permitido"]}
    ]


@pytest.mark.asyncio
async def test_validate_schema_records_degradation_on_giveup():
    # Flowchart sin terminator y sin presupuesto → degradación estructural.
    diagram = DiagramSchema(
        title="T", diagram_type=DiagramType.FLOWCHART,
        nodes=[_n("a"), _n("b")],
        edges=[DiagramEdge(id="1", source="a", target="b", label="", edge_type=EdgeType.FLOW)],
    )
    state = _state(diagram=diagram, schema_retry_count=MAX_SCHEMA_RETRIES)

    result = await validate_schema(state)

    assert result["structural_gaps"] == []
    assert result["degradations"], "registra la carencia estructural"
    assert result["degradations"][0]["category"] == "structure"
    assert result["degradations"][0]["reasons"], "incluye los motivos accionables"
