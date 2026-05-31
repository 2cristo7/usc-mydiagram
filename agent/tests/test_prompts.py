"""Tests de S6.6 — prompts personalizados por tipo de diagrama.

Cubren:
1. El registro devuelve un prompt específico para cada DiagramType (header de
   formato + fragmento semántico del tipo), y el de flowchart nombra los tipos
   propios (decision/terminator/conditional/flow).
2. El criterio de aceptación: una salida ramificada ("comprar en el súper o
   coger de la granja") produce un nodo `decision` con DOS caminos de salida,
   no una cadena lineal. Con el LLM mockeado se verifica el cableado end-to-end
   (extract_nodes → extract_edges) y que los nuevos enums validan vía Pydantic.
"""
import asyncio
from unittest.mock import patch

from state import DiagramState
from schemas import DiagramType, DiagramNode
from prompts import get_node_prompt, get_edge_prompt
from nodes.extract_nodes import make_extract_nodes
from nodes.extract_edges import make_extract_edges


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _astream(chunks):
    for c in chunks:
        yield c


def _make_state(**overrides) -> DiagramState:
    base: DiagramState = {
        "prompt": "test prompt",
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
        "title": None,
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# 1. Registro de prompts
# ---------------------------------------------------------------------------

def test_every_diagram_type_has_specific_prompts():
    """Los 7 tipos producen prompts no vacíos que mencionan su propio tipo."""
    for dt in DiagramType:
        node_p = get_node_prompt(dt)
        edge_p = get_edge_prompt(dt, ["a", "b"])
        assert dt.value in node_p
        assert "array JSON" in node_p
        assert "ids de nodo válidos" in edge_p


def test_flowchart_prompt_names_branching_types():
    """El prompt de flowchart instruye decision/terminator y aristas conditional/flow."""
    node_p = get_node_prompt(DiagramType.FLOWCHART)
    edge_p = get_edge_prompt(DiagramType.FLOWCHART, ["start", "end"])
    assert "decision" in node_p and "terminator" in node_p
    assert "step" in node_p
    assert "conditional" in edge_p and "flow" in edge_p


def test_erd_and_flowchart_prompts_differ():
    """Cada tipo tiene su propia guía: ERD y flowchart no comparten el ejemplo."""
    erd = get_node_prompt(DiagramType.ERD)
    flow = get_node_prompt(DiagramType.FLOWCHART)
    assert erd != flow
    # El ejemplo de ERD habla de tablas; el de flowchart, de decision.
    assert "table" in erd
    assert "decision" not in erd


# ---------------------------------------------------------------------------
# 2. Criterio de aceptación: ramificación, no cadena lineal
# ---------------------------------------------------------------------------

def test_branching_flowchart_produces_decision_with_two_paths():
    """'comprar en el súper o coger de la granja' → un decision con 2 ramas."""
    node_chunks = [
        '[{"id": "start", "label": "Start", "node_type": "terminator", "attributes": []},',
        '{"id": "check_super", "label": "Is it at the supermarket?", "node_type": "decision", "attributes": []},',
        '{"id": "buy_super", "label": "Buy at supermarket", "node_type": "step", "attributes": []},',
        '{"id": "get_farm", "label": "Get from the farm", "node_type": "step", "attributes": []},',
        '{"id": "end", "label": "End", "node_type": "terminator", "attributes": []}]',
    ]
    edge_chunks = [
        '[{"id": "e1", "source": "start", "target": "check_super", "label": "", "edge_type": "flow"},',
        '{"id": "e2", "source": "check_super", "target": "buy_super", "label": "yes", "edge_type": "conditional"},',
        '{"id": "e3", "source": "check_super", "target": "get_farm", "label": "no", "edge_type": "conditional"},',
        '{"id": "e4", "source": "buy_super", "target": "end", "label": "", "edge_type": "flow"},',
        '{"id": "e5", "source": "get_farm", "target": "end", "label": "", "edge_type": "flow"}]',
    ]

    async def run():
        state = _make_state(
            prompt="Para conseguir leche: comprar en el súper o coger de la granja",
            diagram_type=DiagramType.FLOWCHART,
        )
        with patch("nodes.extract_nodes.stream_llm", return_value=_astream(node_chunks)):
            node_out = await make_extract_nodes()(state)
        state["nodes"] = node_out["nodes"]
        with patch("nodes.extract_edges.stream_llm", return_value=_astream(edge_chunks)):
            edge_out = await make_extract_edges()(state)
        return node_out["nodes"], edge_out["edges"]

    nodes, edges = asyncio.run(run())

    # Hay un nodo decision (no todo son step encadenados).
    decisions = [n for n in nodes if n.node_type.value == "decision"]
    assert len(decisions) == 1, "debe haber exactamente un nodo decision"
    decision_id = decisions[0].id

    # El decision tiene DOS aristas de salida → bifurca, no es cadena lineal.
    outgoing = [e for e in edges if e.source == decision_id]
    assert len(outgoing) == 2, "el decision debe tener dos caminos de salida"
    assert all(e.edge_type.value == "conditional" for e in outgoing)

    # Ninguna arista quedó huérfana (todos los nuevos enums validan).
    assert edges, "las aristas deben haberse extraído y validado"
