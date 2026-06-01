"""S6.1 / S6.10 — Pipeline LangGraph de extremo a extremo.

Recorre el grafo COMPILADO (`build_graph`) con un LLM falso, probando que las seis
etapas se cablean y enrutan bien sobre los dos caminos troncales del sprint:

1. Camino feliz: guard acepta → classify → extract_nodes → validate_nodes →
   extract_edges → validate_edges → synthesize → validate_schema → END, con un
   flowchart estructuralmente válido (inicio/fin + paso conectados). Se comprueba
   el diagrama final, que el desenlace sea `done` NO degradado, y que cada
   nodo/arista se empujó a la cola de streaming (eventos node/edge).
2. Guard-reject: guard rechaza → END inmediato (no se ejecuta ninguna otra etapa,
   la cola queda vacía) → classify_outcome lo clasifica como `not_a_diagram`.

El LLM se mockea por módulo (guard/classify usan call_llm; los extractores usan
stream_llm), igual que el E2E de relleno estructural de test_validate_schema.
"""
import asyncio
import pytest
from unittest.mock import patch

from graph import build_graph
from outcome import classify_outcome
import structural


# ----------------------------- LLM falso -----------------------------

async def _fake_stream(text):
    mid = len(text) // 2
    for chunk in (text[:mid], text[mid:]):
        yield chunk


def _stream_router(*, system, user, tier=None, max_tokens=None):
    """Flowchart limpio: inicio(terminator) → proceso(step) → fin(terminator)."""
    if "los NODOS" in system:
        return _fake_stream(
            '[{"id":"inicio","label":"Inicio","node_type":"terminator","attributes":[]},'
            '{"id":"proceso","label":"Proceso","node_type":"step","attributes":[]},'
            '{"id":"fin","label":"Fin","node_type":"terminator","attributes":[]}]'
        )
    if "las ARISTAS" in system:
        return _fake_stream(
            '[{"id":"e1","source":"inicio","target":"proceso","label":"","edge_type":"flow"},'
            '{"id":"e2","source":"proceso","target":"fin","label":"","edge_type":"flow"}]'
        )
    return _fake_stream("[]")


async def _fake_call_llm_accept(*, system, user, tier=None, max_tokens=None):
    if "'yes' or 'no'" in system:        # guard
        return "yes"
    if "one of these values" in system:  # classify tipo
        return "flowchart"
    return "Mi Flowchart"                 # classify título


async def _fake_call_llm_reject(*, system, user, tier=None, max_tokens=None):
    if "'yes' or 'no'" in system:
        return "no"
    return "irrelevante"


def _initial(prompt):
    return {
        "prompt": prompt,
        "is_diagram_request": False,
        "diagram_type": None,
        "title": None,
        "nodes": [], "edges": [], "invalid_edges": [], "invalid_nodes": [],
        "diagram": None,
        "validation_errors": [], "retry_count": 0,
        "node_retry_count": 0, "node_validation_errors": [],
        "structural_gaps": [], "schema_retry_count": 0,
        "degradations": [],
    }


def _drain(queue):
    items = []
    while not queue.empty():
        items.append(queue.get_nowait())
    return items


# ----------------------------- Camino feliz -----------------------------

@pytest.mark.asyncio
async def test_happy_path_produces_clean_done_and_streams():
    queue = asyncio.Queue()
    graph = build_graph(queue)
    with patch("nodes.guard.call_llm", new=_fake_call_llm_accept), \
         patch("nodes.classify.call_llm", new=_fake_call_llm_accept), \
         patch("nodes.extract_nodes.stream_llm", new=_stream_router), \
         patch("nodes.extract_edges.stream_llm", new=_stream_router):
        result = await graph.ainvoke(_initial("flujo para hacer café"))

    diagram = result["diagram"]
    assert {n.id for n in diagram.nodes} == {"inicio", "proceso", "fin"}
    assert len(diagram.edges) == 2
    # Estructuralmente válido → sin huecos, sin degradación.
    assert structural.validate_structure(diagram.diagram_type, diagram.nodes, diagram.edges) == []
    assert result["structural_gaps"] == []

    outcome = classify_outcome(result)
    assert outcome["_type"] == "done"
    assert outcome["degraded"] is False
    assert outcome["title"] == "Mi Flowchart"

    # Render progresivo: cada nodo y cada arista se empujó a la cola.
    events = _drain(queue)
    assert [e["data"]["id"] for e in events if e["_type"] == "node"] == ["inicio", "proceso", "fin"]
    assert {e["data"]["id"] for e in events if e["_type"] == "edge"} == {"e1", "e2"}


# ----------------------------- Guard-reject -----------------------------

@pytest.mark.asyncio
async def test_guard_reject_short_circuits_to_not_a_diagram():
    queue = asyncio.Queue()
    graph = build_graph(queue)
    with patch("nodes.guard.call_llm", new=_fake_call_llm_reject), \
         patch("nodes.classify.call_llm", new=_fake_call_llm_reject), \
         patch("nodes.extract_nodes.stream_llm", new=_stream_router), \
         patch("nodes.extract_edges.stream_llm", new=_stream_router):
        result = await graph.ainvoke(_initial("hola, ¿qué tiempo hace?"))

    # El grafo cortó tras guard: ni clasificó ni extrajo nada.
    assert result["is_diagram_request"] is False
    assert result["diagram"] is None
    assert result["nodes"] == []
    assert queue.empty()

    outcome = classify_outcome(result)
    assert outcome["_type"] == "error"
    assert outcome["category"] == "not_a_diagram"
