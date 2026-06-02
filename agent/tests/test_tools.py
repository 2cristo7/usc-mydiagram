"""S7.2 — Las 9 tools como lógica pura sobre un DiagramWorkspace mutable.

Cada tool devuelve una observación: datos en éxito, {"error": ...} accionable en
fallo. Las tools no deciden el siguiente paso (eso es el agente, S7.3); aquí se
verifica que mutan correctamente el workspace y que el error es fiel.
"""
import pytest

from schemas import DiagramNode, DiagramEdge, NodeType, EdgeType, DiagramType, CompactDiagram
from tools import DiagramWorkspace, _slugify


def erd_workspace() -> DiagramWorkspace:
    """ERD mínimo: Usuario ──one_to_many── Pedido."""
    nodes = [
        DiagramNode(id="usuario", label="Usuario", node_type=NodeType.TABLE, attributes=["email"]),
        DiagramNode(id="pedido", label="Pedido", node_type=NodeType.TABLE, attributes=[]),
    ]
    edges = [
        DiagramEdge(id="usuario__pedido", source="usuario", target="pedido",
                    label="realiza", edge_type=EdgeType.ONE_TO_MANY),
    ]
    return DiagramWorkspace(DiagramType.ERD, nodes, edges)


# --- find_node ---

def test_find_node_substring():
    ws = erd_workspace()
    res = ws.find_node("usuar")
    assert [m["id"] for m in res] == ["usuario"]
    assert res[0]["type"] == "table"


def test_find_node_fuzzy_plural():
    # "Usuarios" (plural) no es substring exacto de "Usuario" pero difflib lo acerca.
    ws = erd_workspace()
    res = ws.find_node("Usuarios")
    assert any(m["id"] == "usuario" for m in res)


def test_find_node_no_match():
    assert erd_workspace().find_node("carrito") == []


# --- add_node ---

def test_add_node_ok_and_id_slug():
    ws = erd_workspace()
    res = ws.add_node(NodeType.TABLE, "Carrito de Compra")
    assert res == {"id": "carrito_de_compra"}
    assert ws._node("carrito_de_compra") is not None


def test_add_node_id_dedup():
    ws = erd_workspace()
    first = ws.add_node(NodeType.TABLE, "Usuario")   # ya existe id "usuario"
    assert first == {"id": "usuario_2"}


def test_add_node_invalid_type_rejected():
    ws = erd_workspace()
    res = ws.add_node(NodeType.DECISION, "Rombo")  # decision no vale en ERD
    assert "error" in res
    assert "decision" in res["error"] and "table" in res["error"]
    # No se añadió nada
    assert ws._node("rombo") is None


def test_add_node_methods_folded_into_attributes():
    ws = DiagramWorkspace(DiagramType.UML_CLASS, [], [])
    res = ws.add_node(NodeType.CLASS, "Cuenta", attributes=["saldo"], methods=["ingresar()"])
    node = ws._node(res["id"])
    assert node.attributes == ["saldo", "ingresar()"]


# --- update_node ---

def test_update_node_partial():
    ws = erd_workspace()
    res = ws.update_node("usuario", label="Cliente")
    assert res["ok"] is True
    assert ws._node("usuario").label == "Cliente"
    assert ws._node("usuario").attributes == ["email"]  # no tocado


def test_update_node_missing():
    res = erd_workspace().update_node("inexistente", label="X")
    assert "error" in res and "inexistente" in res["error"]


def test_update_node_invalid_type_rejected():
    ws = erd_workspace()
    res = ws.update_node("usuario", node_type=NodeType.DECISION)
    assert "error" in res
    assert ws._node("usuario").node_type == NodeType.TABLE  # sin cambios


# --- delete_node (cascade) ---

def test_delete_node_cascade_edges():
    ws = erd_workspace()
    res = ws.delete_node("usuario")
    assert res["deleted_node"] == "usuario"
    assert res["deleted_edges"] == ["usuario__pedido"]
    assert ws._node("usuario") is None
    assert ws.edges == []  # la arista conectada se borró en cascada


def test_delete_node_missing():
    res = erd_workspace().delete_node("nope")
    assert "error" in res


# --- add_edge ---

def test_add_edge_ok():
    ws = erd_workspace()
    ws.add_node(NodeType.TABLE, "Carrito")
    res = ws.add_edge("usuario", "carrito", EdgeType.ONE_TO_MANY, label="tiene")
    assert "id" in res
    assert ws._edge(res["id"]).target == "carrito"


def test_add_edge_missing_node_no_autocreate():
    # Invariante S6.5c: las aristas NUNCA crean nodos.
    ws = erd_workspace()
    before = len(ws.nodes)
    res = ws.add_edge("usuario", "carrito", EdgeType.ONE_TO_MANY)  # carrito no existe
    assert "error" in res and "carrito" in res["error"]
    assert len(ws.nodes) == before  # no se inventó el nodo
    assert all(e.target != "carrito" for e in ws.edges)


def test_add_edge_invalid_type_rejected():
    ws = erd_workspace()
    res = ws.add_edge("usuario", "pedido", EdgeType.FLOW)  # flow no vale en ERD
    assert "error" in res and "flow" in res["error"]


# --- delete_edge ---

def test_delete_edge_ok():
    ws = erd_workspace()
    res = ws.delete_edge("usuario__pedido")
    assert res["ok"] is True
    assert ws.edges == []


def test_delete_edge_missing():
    assert "error" in erd_workspace().delete_edge("nope")


# --- tools "raras" (frontera de stub) ---

def test_apply_layout_noop():
    res = erd_workspace().apply_layout()
    assert res["ok"] is True


def test_ask_clarification_returns_intent_marker():
    res = erd_workspace().ask_clarification("¿A qué Usuario?", options=["A", "B"])
    assert res["_interrupt"] == "clarification"
    assert res["question"] == "¿A qué Usuario?"
    assert res["options"] == ["A", "B"]


def test_regenerate_returns_intent_marker():
    res = erd_workspace().regenerate_from_scratch("hazlo de secuencia", DiagramType.SEQUENCE)
    assert res["_regenerate"] is True
    assert res["diagram_type"] == "sequence"


# --- workspace round-trip + permisividad de tipo sin registro ---

def test_to_compact_roundtrip():
    ws = erd_workspace()
    ws.add_node(NodeType.TABLE, "Producto")
    compact = ws.to_compact()
    assert isinstance(compact, CompactDiagram)
    assert {n.id for n in compact.nodes} == {"usuario", "pedido", "producto"}


def test_slugify_strips_accents():
    assert _slugify("Categoría de Régimen") == "categoria_de_regimen"
