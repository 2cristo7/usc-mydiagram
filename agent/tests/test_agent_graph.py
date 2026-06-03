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
"""
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
