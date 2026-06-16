"""S6.8 — Validación estructural del esquema ensamblado.

Cubre el mecanismo completo:
- reglas estructurales por tipo (structural.py): existencia (nodes) vs conexión (edges);
- el nodo validate_schema y su bucle con presupuesto propio (schema_retry_count);
- route_after_validate_schema (nodes → extract_nodes, edges → extract_edges, vacío → END);
- el modo "rellenar hueco" de los extractores y su prioridad (fill > corregir > normal);
- camino feliz E2E: un flowchart sin terminator se detecta y se rellena en UNA vuelta.
"""
import asyncio
import pytest
from unittest.mock import patch

from schemas import DiagramNode, DiagramEdge, DiagramSchema, NodeType, EdgeType, DiagramType
import structural
from nodes.validate_schema import validate_schema, MAX_SCHEMA_RETRIES
from nodes.extract_nodes import make_extract_nodes
from nodes.extract_edges import make_extract_edges
from graph import route_after_validate_schema, build_graph
from langgraph.graph import END


def _n(i, t=NodeType.STEP, label=None):
    return DiagramNode(id=i, label=label or i.title(), node_type=t, attributes=[])


def _e(i, a, b, t=EdgeType.FLOW):
    return DiagramEdge(id=i, source=a, target=b, label="", edge_type=t)


async def _fake_stream(text):
    mid = len(text) // 2
    for chunk in (text[:mid], text[mid:]):
        yield chunk


def _schema_state(diagram=None, **overrides):
    state = {
        "prompt": "para conseguir leche, mira en el super; cómprala",
        "is_diagram_request": True,
        "diagram_type": DiagramType.FLOWCHART,
        "nodes": [],
        "edges": [],
        "invalid_edges": [],
        "invalid_nodes": [],
        "diagram": diagram,
        "validation_errors": [],
        "retry_count": 0,
        "node_retry_count": 0,
        "node_validation_errors": [],
        "structural_gaps": [],
        "schema_retry_count": 0,
        "title": "Flujo",
    }
    state.update(overrides)
    return state


def _flowchart(nodes, edges):
    return DiagramSchema(title="Flujo", diagram_type=DiagramType.FLOWCHART, nodes=nodes, edges=edges)


# ============================ A. reglas estructurales ============================

def _gaps(nodes, edges):
    return structural.validate_structure(DiagramType.FLOWCHART, nodes, edges)


def test_no_terminator_emits_nodes_and_edges_together():
    # Sin terminator: faltan los nodos Y sus conexiones → un gap nodes + uno edges,
    # para resolverlo en UNA vuelta del grafo (extract_nodes y extract_edges).
    gaps = _gaps([_n("a"), _n("b")], [_e("1", "a", "b")])
    types = sorted(g["type"] for g in gaps)
    assert types == ["edges", "nodes"]


def test_existing_terminators_unconnected_emit_only_edges():
    # Los terminators existen (recién creados, huérfanos): el problema es de
    # CONEXIÓN, no de nodos → ningún gap nodes (no se apilan más nodos).
    gaps = _gaps(
        [_n("ini", NodeType.TERMINATOR), _n("fin", NodeType.TERMINATOR), _n("a"), _n("b")],
        [_e("1", "a", "b")],
    )
    assert gaps, "debe detectar que faltan conexiones"
    assert all(g["type"] == "edges" for g in gaps), "solo conexión, nunca nodos"


def test_isolated_group_emits_edges():
    gaps = _gaps(
        [_n("ini", NodeType.TERMINATOR), _n("a"), _n("fin", NodeType.TERMINATOR), _n("g1"), _n("g2")],
        [_e("1", "ini", "a"), _e("2", "a", "fin"), _e("3", "g1", "g2")],
    )
    reasons = " ".join(g["reason"] for g in gaps)
    assert "aislado" in reasons and all(g["type"] == "edges" for g in gaps)


def test_wellformed_flowchart_has_no_gaps():
    gaps = _gaps(
        [_n("ini", NodeType.TERMINATOR), _n("a"), _n("fin", NodeType.TERMINATOR)],
        [_e("1", "ini", "a"), _e("2", "a", "fin")],
    )
    assert gaps == []


@pytest.mark.parametrize("dt", [DiagramType.ERD, DiagramType.ARCHITECTURE, DiagramType.USE_CASE])
def test_permissive_types_have_no_rules(dt):
    # Tipos con elementos independientes legítimos → permisivos por diseño: un
    # nodo aislado no dispara nada.
    assert structural.validate_structure(dt, [_n("a"), _n("b")], []) == []


# ---- mindmap ----

def test_mindmap_single_topic_is_legit():
    assert structural.validate_structure(DiagramType.MINDMAP, [_n("centro", NodeType.TOPIC)], []) == []


def test_mindmap_without_central_root_flags_edges():
    # Dos topics en ciclo: ninguno con in-degree 0 → no hay centro.
    gaps = structural.validate_structure(
        DiagramType.MINDMAP,
        [_n("a", NodeType.TOPIC), _n("b", NodeType.TOPIC)],
        [_e("1", "a", "b", EdgeType.ASSOCIATION), _e("2", "b", "a", EdgeType.ASSOCIATION)],
    )
    assert gaps and all(g["type"] == "edges" for g in gaps)
    assert "central" in " ".join(g["reason"] for g in gaps)


def test_mindmap_wellformed_has_no_gaps():
    gaps = structural.validate_structure(
        DiagramType.MINDMAP,
        [_n("centro", NodeType.TOPIC), _n("idea1", NodeType.TOPIC), _n("idea2", NodeType.TOPIC)],
        [_e("1", "centro", "idea1", EdgeType.ASSOCIATION), _e("2", "centro", "idea2", EdgeType.ASSOCIATION)],
    )
    assert gaps == []


# ---- sequence ----

def test_sequence_with_one_actor_flags_nodes():
    gaps = structural.validate_structure(DiagramType.SEQUENCE, [_n("a", NodeType.ACTOR)], [])
    assert gaps and gaps[0]["type"] == "nodes"
    assert "2 actores" in gaps[0]["reason"]


def test_sequence_wellformed_has_no_gaps():
    gaps = structural.validate_structure(
        DiagramType.SEQUENCE,
        [_n("a", NodeType.ACTOR), _n("b", NodeType.ACTOR)],
        [_e("1", "a", "b", EdgeType.SEQUENCE)],
    )
    assert gaps == []


# ---- use_case — validación semántica ----

def test_use_case_accepts_actor_use_case_system_nodes():
    """Los node_types propios de use_case pasan la validación semántica."""
    from schemas import node_type_allowed
    for nt in (NodeType.ACTOR, NodeType.USE_CASE, NodeType.SYSTEM):
        assert node_type_allowed(DiagramType.USE_CASE, nt), f"{nt} debe estar permitido en use_case"


def test_use_case_rejects_foreign_node_types():
    """node_types de otros diagramas se rechazan en use_case."""
    from schemas import node_type_allowed
    for nt in (NodeType.TABLE, NodeType.STEP, NodeType.TOPIC, NodeType.SERVICE):
        assert not node_type_allowed(DiagramType.USE_CASE, nt), f"{nt} no debe estar permitido en use_case"


def test_use_case_accepts_association_include_extend_inherits():
    """Las cuatro edge_types del use_case son todas válidas."""
    from schemas import edge_type_allowed
    for et in (EdgeType.ASSOCIATION, EdgeType.INCLUDE, EdgeType.EXTEND, EdgeType.INHERITS):
        assert edge_type_allowed(DiagramType.USE_CASE, et), f"{et} debe estar permitido en use_case"


def test_use_case_rejects_foreign_edge_types():
    """edge_types de otros diagramas se rechazan en use_case."""
    from schemas import edge_type_allowed
    for et in (EdgeType.FLOW, EdgeType.SEQUENCE, EdgeType.ONE_TO_MANY, EdgeType.CALLS):
        assert not edge_type_allowed(DiagramType.USE_CASE, et), f"{et} no debe estar permitido en use_case"


def test_use_case_is_structurally_permissive():
    """use_case no tiene validador estructural: un actor sin casos de uso es legítimo."""
    gaps = structural.validate_structure(
        DiagramType.USE_CASE,
        [_n("cliente", NodeType.ACTOR), _n("admin", NodeType.ACTOR)],
        [],
    )
    assert gaps == []


# ============================ B. nodo validate_schema ============================

@pytest.mark.asyncio
async def test_validate_schema_retries_when_gaps_and_budget():
    diagram = _flowchart([_n("a"), _n("b")], [_e("1", "a", "b")])  # sin terminator
    state = _schema_state(diagram=diagram, schema_retry_count=0)

    result = await validate_schema(state)

    assert result["structural_gaps"], "reporta los huecos para el reintento"
    assert result["schema_retry_count"] == 1, "incrementa su presupuesto propio"


@pytest.mark.asyncio
async def test_validate_schema_degrades_when_budget_exhausted():
    diagram = _flowchart([_n("a"), _n("b")], [_e("1", "a", "b")])
    state = _schema_state(diagram=diagram, schema_retry_count=MAX_SCHEMA_RETRIES)

    result = await validate_schema(state)

    assert result["structural_gaps"] == [], "degrada: no reintenta más"
    assert "schema_retry_count" not in result, "no toca el contador al rendirse"


@pytest.mark.asyncio
async def test_validate_schema_passes_when_wellformed():
    diagram = _flowchart(
        [_n("ini", NodeType.TERMINATOR), _n("a"), _n("fin", NodeType.TERMINATOR)],
        [_e("1", "ini", "a"), _e("2", "a", "fin")],
    )
    result = await validate_schema(_schema_state(diagram=diagram))
    assert result["structural_gaps"] == []


@pytest.mark.asyncio
async def test_validate_schema_no_diagram_is_noop():
    result = await validate_schema(_schema_state(diagram=None))
    assert result["structural_gaps"] == []


# ============================ C. route_after_validate_schema ============================

def test_route_to_extract_nodes_on_node_gap():
    state = _schema_state(structural_gaps=[{"type": "nodes", "reason": "r"}])
    assert route_after_validate_schema(state) == "extract_nodes"


def test_route_to_extract_edges_on_edge_gap():
    state = _schema_state(structural_gaps=[{"type": "edges", "reason": "r"}])
    assert route_after_validate_schema(state) == "extract_edges"


def test_route_mixed_prioritizes_nodes():
    state = _schema_state(structural_gaps=[{"type": "edges", "reason": "r"}, {"type": "nodes", "reason": "r"}])
    assert route_after_validate_schema(state) == "extract_nodes"


def test_route_ends_when_no_gaps():
    assert route_after_validate_schema(_schema_state(structural_gaps=[])) == END


# ============================ D. extractores en modo rellenar ============================

@pytest.mark.asyncio
async def test_extract_nodes_fill_mode_adds_missing_terminator():
    queue = asyncio.Queue()
    state = _schema_state(
        nodes=[_n("a"), _n("b")],
        structural_gaps=[{"type": "nodes", "reason": "falta un terminator de inicio y uno de fin"}],
    )
    added = '[{"id": "inicio", "label": "Inicio", "node_type": "terminator", "attributes": []}]'

    with patch("nodes.extract_nodes.stream_llm", return_value=_fake_stream(added)) as m:
        result = await make_extract_nodes(queue)(state)

    assert "AÑADIENDO los nodos" in m.call_args.kwargs["system"], "usó el prompt de relleno"
    assert [n.id for n in result["nodes"]] == ["inicio"]
    assert queue.get_nowait()["data"]["id"] == "inicio", "el nodo nuevo se streamea"


@pytest.mark.asyncio
async def test_extract_edges_fill_mode_connects_terminator():
    queue = asyncio.Queue()
    state = _schema_state(
        nodes=[_n("inicio", NodeType.TERMINATOR), _n("a")],
        structural_gaps=[{"type": "edges", "reason": "conecta el terminator de inicio con el primer paso"}],
    )
    added = '[{"id": "e_ini", "source": "inicio", "target": "a", "label": "", "edge_type": "flow"}]'

    with patch("nodes.extract_edges.stream_llm", return_value=_fake_stream(added)) as m:
        result = await make_extract_edges(queue)(state)

    assert "AÑADIENDO las aristas" in m.call_args.kwargs["system"]
    assert [e.id for e in result["edges"]] == ["e_ini"]


@pytest.mark.asyncio
async def test_fill_mode_takes_priority_over_correct():
    # Coexisten structural_gaps (rellenar) e invalid_nodes (corregir): debe ganar
    # rellenar, porque venir de validate_schema implica que el bucle local terminó.
    queue = asyncio.Queue()
    state = _schema_state(
        nodes=[_n("a")],
        invalid_nodes=[{"raw": {"id": "x"}, "reason": "residual"}],
        structural_gaps=[{"type": "nodes", "reason": "falta un terminator"}],
    )
    with patch("nodes.extract_nodes.stream_llm", return_value=_fake_stream("[]")) as m:
        await make_extract_nodes(queue)(state)

    assert "AÑADIENDO los nodos" in m.call_args.kwargs["system"], "rellenar > corregir"


# ============================ E. camino feliz E2E (1 vuelta) ============================

def _stream_router(*, system, user, tier=None, max_tokens=None):
    """Mock de stream_llm: responde según el modo del prompt del extractor."""
    if "AÑADIENDO los nodos" in system:                 # fill nodes
        return _fake_stream(
            '[{"id":"inicio","label":"Inicio","node_type":"terminator","attributes":[]},'
            '{"id":"fin","label":"Fin","node_type":"terminator","attributes":[]}]'
        )
    if "AÑADIENDO las aristas" in system:               # fill edges
        return _fake_stream(
            '[{"id":"e_ini","source":"inicio","target":"a","label":"","edge_type":"flow"},'
            '{"id":"e_fin","source":"b","target":"fin","label":"","edge_type":"flow"}]'
        )
    if "los NODOS" in system:                           # normal nodes (sin terminator)
        return _fake_stream(
            '[{"id":"a","label":"Paso A","node_type":"step","attributes":[]},'
            '{"id":"b","label":"Paso B","node_type":"step","attributes":[]}]'
        )
    if "las ARISTAS" in system:                         # normal edges
        return _fake_stream('[{"id":"e1","source":"a","target":"b","label":"","edge_type":"flow"}]')
    return _fake_stream("[]")


async def _fake_call_llm(*, system, user, tier=None, max_tokens=None):
    if "'yes' or 'no'" in system:
        return "yes"
    if "one of these values" in system:
        return "flowchart"
    return "Conseguir leche"


@pytest.mark.asyncio
async def test_e2e_missing_terminator_filled_in_one_round():
    initial = _schema_state(nodes=[], edges=[], diagram=None)
    graph = build_graph(None)

    with patch("nodes.guard.call_llm", new=_fake_call_llm), \
         patch("nodes.classify.call_llm", new=_fake_call_llm), \
         patch("nodes.extract_nodes.stream_llm", new=_stream_router), \
         patch("nodes.extract_edges.stream_llm", new=_stream_router):
        result = await graph.ainvoke(initial)

    diagram = result["diagram"]
    node_ids = {n.id for n in diagram.nodes}
    # El terminator faltante se añadió y se conectó.
    assert {"inicio", "fin"} <= node_ids
    # El diagrama final ya es estructuralmente válido (el bucle convergió).
    assert structural.validate_structure(diagram.diagram_type, diagram.nodes, diagram.edges) == []
    assert result["structural_gaps"] == []
    # Se resolvió en UNA sola vuelta estructural.
    assert result["schema_retry_count"] == 1
