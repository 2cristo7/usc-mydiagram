"""S7.3 — Grafo del agente ReAct (agent_graph.py).

Cubre el loop think→tool→observation cerrado sobre un DiagramWorkspace, sin tocar
un LLM real: se inyecta un chat-model FALSO (_FakeModel) que devuelve una secuencia
guionizada de AIMessage (unos con tool_calls, el último solo texto = "he terminado").
Así se verifica la TOPOLOGÍA del grafo y el efecto de las tools sobre el workspace,
de forma determinista.

Escenarios:
- build_tools: las 9 tools, nombres correctos, ejecución muta el workspace de cierre.
- add_node + add_edge: el entregable "añade Carrito entre … y Producto".
- find_node + delete_edge: cirugía dirigida sobre el diagrama.
- observación de error: add_edge a un nodo inexistente no rompe el loop ni muta.
- terminación: una respuesta sin tool_calls cierra el grafo dejando el diagrama intacto.
- regenerate_from_scratch: sale por la rama dedicada y REEMPLAZA el workspace con el
  resultado del pipeline de generación (build_graph mockeado).

S7.4 añade: pausa/reanudación de ask_clarification con interrupt()/Command(resume),
no-duplicación de tools hermanas al reanudar, prioridad clarify > regenerate,
extract_history y el contrato HTTP de /refine/resume.
"""
import json

import pytest
from unittest.mock import patch
from langchain_core.messages import AIMessage

import agent_graph
import graph as graph_module
import main
from agent_graph import build_tools, build_agent_graph
from schemas import (
    DiagramNode, DiagramEdge, DiagramSchema, CompactDiagram,
    NodeType, EdgeType, DiagramType,
)
from tools import DiagramWorkspace


# ---------------------------------------------------------------------------
# Dobles de prueba
# ---------------------------------------------------------------------------

class _FakeBound:
    """Lo que devuelve _FakeModel.bind_tools: responde la secuencia guionizada,
    una AIMessage por cada vuelta del nodo `agent`."""
    def __init__(self, responses):
        self._responses = list(responses)

    async def ainvoke(self, messages):
        return self._responses.pop(0)


class _FakeModel:
    def __init__(self, responses):
        self._responses = responses

    def bind_tools(self, tools):
        return _FakeBound(self._responses)


class _FakeGenGraph:
    """Pipeline de generación S6 mockeado: ainvoke devuelve un estado final con un
    diagrama ya ensamblado (lo que regenerate_from_scratch espera consumir)."""
    def __init__(self, diagram):
        self._diagram = diagram

    async def ainvoke(self, state):
        return {"diagram": self._diagram}


def _tool_call(name, args, call_id="c1"):
    return {"name": name, "args": args, "id": call_id, "type": "tool_call"}


def _ai_tool(name, args, call_id="c1"):
    return AIMessage(content="", tool_calls=[_tool_call(name, args, call_id)])


_DONE = AIMessage(content="Listo.")  # sin tool_calls → tools_condition → END


def _seed_erd() -> DiagramWorkspace:
    diagram = CompactDiagram(
        diagram_type=DiagramType.ERD,
        nodes=[
            DiagramNode(id="usuario", label="Usuario", node_type=NodeType.TABLE),
            DiagramNode(id="producto", label="Producto", node_type=NodeType.TABLE),
        ],
        edges=[
            DiagramEdge(id="usuario__producto", source="usuario", target="producto",
                        label="compra", edge_type=EdgeType.MANY_TO_MANY),
        ],
    )
    return DiagramWorkspace.from_compact(diagram)


def _patch_model(monkeypatch, responses):
    monkeypatch.setattr(agent_graph, "get_chat_model", lambda tier="capable": _FakeModel(responses))


# ---------------------------------------------------------------------------
# build_tools
# ---------------------------------------------------------------------------

def test_build_tools_names_and_count():
    ws = _seed_erd()
    tools = build_tools(ws)
    names = [t.name for t in tools]
    assert names == [
        "find_node", "add_node", "update_node", "delete_node",
        "add_edge", "delete_edge", "apply_layout", "ask_clarification",
        "regenerate_from_scratch",
    ]


def test_build_tools_closure_mutates_workspace():
    ws = _seed_erd()
    add_node = next(t for t in build_tools(ws) if t.name == "add_node")
    out = add_node.invoke({"node_type": "table", "label": "Carrito"})
    assert '"id": "carrito"' in out
    assert any(n.id == "carrito" for n in ws.nodes)  # mutó ESTE workspace


# ---------------------------------------------------------------------------
# Loop ReAct
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_add_node_then_add_edge(monkeypatch):
    ws = _seed_erd()
    _patch_model(monkeypatch, [
        _ai_tool("add_node", {"node_type": "table", "label": "Carrito"}),
        _ai_tool("add_edge", {"source": "carrito", "target": "producto",
                              "edge_type": "one_to_many"}),
        _DONE,
    ])
    await build_agent_graph(ws).ainvoke({"messages": []})

    assert any(n.id == "carrito" for n in ws.nodes)
    assert any(e.source == "carrito" and e.target == "producto" for e in ws.edges)


@pytest.mark.asyncio
async def test_find_node_then_delete_edge(monkeypatch):
    ws = _seed_erd()
    _patch_model(monkeypatch, [
        _ai_tool("find_node", {"query": "Usuario"}),
        _ai_tool("delete_edge", {"id": "usuario__producto"}),
        _DONE,
    ])
    await build_agent_graph(ws).ainvoke({"messages": []})

    assert ws.edges == []


@pytest.mark.asyncio
async def test_error_observation_does_not_break_loop(monkeypatch):
    ws = _seed_erd()
    _patch_model(monkeypatch, [
        _ai_tool("add_edge", {"source": "usuario", "target": "inexistente",
                              "edge_type": "one_to_many"}),
        _DONE,
    ])
    await build_agent_graph(ws).ainvoke({"messages": []})

    # add_edge a un nodo inexistente devuelve {"error"} y NO muta; el loop sigue
    # hasta el mensaje final sin reventar.
    assert len(ws.edges) == 1


@pytest.mark.asyncio
async def test_terminates_with_no_tool_calls(monkeypatch):
    ws = _seed_erd()
    _patch_model(monkeypatch, [_DONE])
    await build_agent_graph(ws).ainvoke({"messages": []})

    # Sin tool calls el grafo va directo a END: diagrama intacto.
    assert len(ws.nodes) == 2
    assert len(ws.edges) == 1


# ---------------------------------------------------------------------------
# Escape hatch: regenerate_from_scratch
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_regenerate_replaces_workspace(monkeypatch):
    ws = _seed_erd()  # arranca como ERD de 2 tablas

    new_diagram = DiagramSchema(
        title="Secuencia",
        diagram_type=DiagramType.SEQUENCE,
        nodes=[DiagramNode(id="cliente", label="Cliente", node_type=NodeType.ACTOR)],
        edges=[],
    )
    monkeypatch.setattr(graph_module, "build_graph", lambda queue=None: _FakeGenGraph(new_diagram))
    _patch_model(monkeypatch, [
        _ai_tool("regenerate_from_scratch", {"prompt": "conviértelo en secuencia"}),
        # no hace falta una 2ª respuesta: regenerate sale por su rama a END, no
        # vuelve al agente.
    ])
    await build_agent_graph(ws).ainvoke({"messages": []})

    assert ws.diagram_type == DiagramType.SEQUENCE
    assert [n.id for n in ws.nodes] == ["cliente"]
    assert ws.edges == []


# ---------------------------------------------------------------------------
# Endpoint /refine/stream (contrato HTTP de extremo a extremo)
# ---------------------------------------------------------------------------

def _erd_body():
    return {
        "prompt": "añade Carrito entre Usuario y Producto",
        "diagram": {
            "diagram_type": "erd",
            "nodes": [
                {"id": "usuario", "label": "Usuario", "node_type": "table", "attributes": []},
                {"id": "producto", "label": "Producto", "node_type": "table", "attributes": []},
            ],
            "edges": [],
        },
    }


def test_refine_stream_emits_done_with_full_diagram():
    """E2E del endpoint: el diagrama que las tools mutan en el workspace es el que
    sale en el evento `done` (snapshot completo, no incremental)."""
    from fastapi.testclient import TestClient

    responses = [
        _ai_tool("add_node", {"node_type": "table", "label": "Carrito"}),
        _ai_tool("add_edge", {"source": "carrito", "target": "producto",
                              "edge_type": "one_to_many"}, "c2"),
        _DONE,
    ]
    with patch.object(agent_graph, "get_chat_model", lambda tier="capable": _FakeModel(responses)):
        resp = TestClient(main.app).post("/refine/stream", json=_erd_body())

    assert resp.status_code == 200
    import json
    event = json.loads(resp.text.strip())
    assert event["_type"] == "done"
    assert {n["id"] for n in event["diagram"]["nodes"]} == {"usuario", "producto", "carrito"}
    assert [(e["source"], e["target"]) for e in event["diagram"]["edges"]] == [("carrito", "producto")]


def test_refine_stream_rejects_malformed_diagram():
    """El contrato CompactDiagram se valida en la entrada (S7.1): un diagram_type
    fuera del enum → 422 explícito, no fallo silencioso."""
    from fastapi.testclient import TestClient

    bad = {"prompt": "x", "diagram": {"diagram_type": "INVALID", "nodes": [], "edges": []}}
    resp = TestClient(main.app).post("/refine/stream", json=bad)
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# S7.4 — interrupt() para ask_clarification + refinement_history
# ---------------------------------------------------------------------------

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command


class _SharedFakeModel:
    """Variante de _FakeModel cuyo bound comparte la MISMA lista de respuestas:
    necesario cuando el grafo se reconstruye entre pausa y reanudación (dos
    peticiones HTTP → dos build_agent_graph → dos bind_tools), y el guion debe
    continuar donde se quedó, no reiniciarse."""
    def __init__(self, responses):
        self.responses = list(responses)

    def bind_tools(self, tools):
        outer = self

        class _Bound:
            async def ainvoke(self, messages):
                return outer.responses.pop(0)

        return _Bound()


def _config(thread_id="t1"):
    return {"configurable": {"thread_id": thread_id}, "recursion_limit": 50}


@pytest.mark.asyncio
async def test_clarification_pauses_and_resume_continues(monkeypatch):
    """ask_clarification pausa el grafo (resultado con __interrupt__ y el payload
    pregunta+opciones); Command(resume=...) lo reanuda y la respuesta del usuario
    guía la siguiente tool."""
    ws = _seed_erd()
    _patch_model(monkeypatch, [
        _ai_tool("ask_clarification", {"question": "¿Conecto Carrito a Usuario o a Producto?",
                                       "options": ["Usuario", "Producto"]}),
        _ai_tool("add_edge", {"source": "usuario", "target": "producto",
                              "edge_type": "one_to_one"}, "c2"),
        _DONE,
    ])
    graph = build_agent_graph(ws, checkpointer=InMemorySaver())

    result = await graph.ainvoke({"messages": []}, _config())

    assert "__interrupt__" in result
    payload = result["__interrupt__"][0].value
    assert payload["question"] == "¿Conecto Carrito a Usuario o a Producto?"
    assert payload["options"] == ["Usuario", "Producto"]
    assert len(ws.edges) == 1  # nada mutó todavía por la clarificación

    result = await graph.ainvoke(Command(resume="Usuario"), _config())

    assert "__interrupt__" not in result
    assert any(e.edge_type.value == "one_to_one" for e in ws.edges)
    # La respuesta entró al historial como voz del usuario para el agente.
    assert any("Usuario" in str(m.content) for m in result["messages"]
               if m.__class__.__name__ == "HumanMessage")


@pytest.mark.asyncio
async def test_sibling_tool_not_reexecuted_on_resume(monkeypatch):
    """El caso trampa: add_node + ask_clarification en el MISMO turno. El add_node
    corre una sola vez (queda checkpointeado); al reanudar solo se re-ejecuta el
    nodo clarify (interrupt idempotente) → no aparece carrito_2 duplicado."""
    ws = _seed_erd()
    mixed = AIMessage(content="", tool_calls=[
        _tool_call("add_node", {"node_type": "table", "label": "Carrito"}, "c1"),
        _tool_call("ask_clarification", {"question": "¿Lo conecto a Usuario o a Pedido?"}, "c2"),
    ])
    _patch_model(monkeypatch, [mixed, _DONE])
    graph = build_agent_graph(ws, checkpointer=InMemorySaver())

    result = await graph.ainvoke({"messages": []}, _config())
    assert "__interrupt__" in result
    assert [n.id for n in ws.nodes if n.id.startswith("carrito")] == ["carrito"]

    await graph.ainvoke(Command(resume="a Usuario"), _config())
    # Sin duplicado tras reanudar: el ToolNode del turno mixto NO se re-ejecutó.
    assert [n.id for n in ws.nodes if n.id.startswith("carrito")] == ["carrito"]


@pytest.mark.asyncio
async def test_clarify_wins_over_regenerate_same_turn(monkeypatch):
    """Si un turno trae ask_clarification Y regenerate_from_scratch, la
    clarificación gana: preguntar antes de tirar el diagrama."""
    ws = _seed_erd()
    mixed = AIMessage(content="", tool_calls=[
        _tool_call("regenerate_from_scratch", {"prompt": "rehazlo"}, "c1"),
        _tool_call("ask_clarification", {"question": "¿Seguro que quieres rehacerlo?"}, "c2"),
    ])
    _patch_model(monkeypatch, [mixed, _DONE])
    graph = build_agent_graph(ws, checkpointer=InMemorySaver())

    result = await graph.ainvoke({"messages": []}, _config())

    assert "__interrupt__" in result          # pausó, no regeneró
    assert len(ws.nodes) == 2                 # el workspace sigue intacto


# ---------------------------------------------------------------------------
# extract_history
# ---------------------------------------------------------------------------

def test_extract_history_pairs_calls_with_results():
    from langchain_core.messages import HumanMessage, ToolMessage
    from agent_graph import extract_history

    messages = [
        HumanMessage(content="añade Carrito"),
        AIMessage(content="", tool_calls=[
            _tool_call("add_node", {"node_type": "table", "label": "Carrito"}, "c1"),
        ]),
        ToolMessage(content='{"id": "carrito"}', tool_call_id="c1"),
        AIMessage(content="", tool_calls=[
            _tool_call("add_edge", {"source": "carrito", "target": "producto",
                                    "edge_type": "one_to_many"}, "c2"),
        ]),
        ToolMessage(content='{"id": "carrito__producto"}', tool_call_id="c2"),
        AIMessage(content="Listo."),
    ]
    history = extract_history(messages)

    assert history == [
        {"tool": "add_node", "args": {"node_type": "table", "label": "Carrito"},
         "result": {"id": "carrito"}},
        {"tool": "add_edge", "args": {"source": "carrito", "target": "producto",
                                      "edge_type": "one_to_many"},
         "result": {"id": "carrito__producto"}},
    ]


def test_extract_history_empty_when_no_tool_calls():
    from agent_graph import extract_history
    assert extract_history([AIMessage(content="Listo.")]) == []


# ---------------------------------------------------------------------------
# Endpoints /refine/stream (clarification) y /refine/resume — contrato HTTP
# ---------------------------------------------------------------------------

def test_refine_clarification_roundtrip_over_http():
    """E2E de las DOS peticiones: /refine/stream pausa y devuelve clarification
    con thread_id; /refine/resume con ese thread_id continúa hasta done, con el
    refinement_history completo (incluida la ask_clarification)."""
    from fastapi.testclient import TestClient

    model = _SharedFakeModel([
        _ai_tool("ask_clarification", {"question": "¿A qué nodo lo conecto?",
                                       "options": ["Usuario", "Producto"]}),
        _ai_tool("add_node", {"node_type": "table", "label": "Carrito"}, "c2"),
        _DONE,
    ])
    client = TestClient(main.app)
    with patch.object(agent_graph, "get_chat_model", lambda tier="capable": model):
        resp = client.post("/refine/stream", json=_erd_body())
        assert resp.status_code == 200
        event = json.loads(resp.text.strip())
        assert event["_type"] == "clarification"
        assert event["question"] == "¿A qué nodo lo conecto?"
        assert event["options"] == ["Usuario", "Producto"]
        thread_id = event["thread_id"]

        resp = client.post("/refine/resume", json={"thread_id": thread_id, "answer": "Usuario"})
        assert resp.status_code == 200
        event = json.loads(resp.text.strip())

    assert event["_type"] == "done"
    assert "carrito" in {n["id"] for n in event["diagram"]["nodes"]}
    tools_called = [h["tool"] for h in event["refinement_history"]]
    assert tools_called == ["ask_clarification", "add_node"]


def test_refine_resume_unknown_thread_returns_404():
    from fastapi.testclient import TestClient
    resp = TestClient(main.app).post("/refine/resume",
                                     json={"thread_id": "no-existe", "answer": "Usuario"})
    assert resp.status_code == 404


def test_refine_resume_rejects_empty_answer():
    from fastapi.testclient import TestClient
    resp = TestClient(main.app).post("/refine/resume", json={"thread_id": "x", "answer": ""})
    assert resp.status_code == 422


def test_refine_done_includes_refinement_history():
    """El done de un refinamiento sin clarificación también lleva la traza."""
    from fastapi.testclient import TestClient

    responses = [
        _ai_tool("add_node", {"node_type": "table", "label": "Carrito"}),
        _DONE,
    ]
    with patch.object(agent_graph, "get_chat_model", lambda tier="capable": _FakeModel(responses)):
        resp = TestClient(main.app).post("/refine/stream", json=_erd_body())

    event = json.loads(resp.text.strip())
    assert event["_type"] == "done"
    assert [h["tool"] for h in event["refinement_history"]] == ["add_node"]
    assert event["refinement_history"][0]["result"] == {"id": "carrito"}
