import asyncio
from langgraph.graph import StateGraph, END
from state import DiagramState
from nodes.guard import guard
from nodes.classify import classify
from nodes.extract_nodes import make_extract_nodes
from nodes.extract_edges import make_extract_edges
from nodes.synthesize import synthesize
from nodes.validate_edges import validate_edges
from nodes.validate_nodes import validate_nodes
from nodes.validate_schema import validate_schema


def route_after_guard(state: DiagramState) -> str:
    return "classify" if state["is_diagram_request"] else END

def route_after_validate_nodes(state: DiagramState) -> str:
    # node_validation_errors no-vacío = validate_nodes decidió reintentar (hay nodos
    # inválidos y queda presupuesto). El tope vive en validate_nodes, no aquí. Volvemos
    # a extract_nodes (modo feedback) para regenerar solo los retenidos. Vacío → seguir.
    if state["node_validation_errors"]:
        return "extract_nodes"
    return "extract_edges"

def route_after_validate_edges(state: DiagramState) -> str:
    # validation_errors no-vacío = validate_edges decidió reintentar (hay inválidas y
    # queda presupuesto). El tope vive en validate_edges, no aquí. Volvemos a la
    # EXTRACCIÓN para regenerar solo las aristas inválidas con feedback. Limpio →
    # synthesize (S6.8 reordenó: validate_edges va ANTES de synthesize, así no se
    # ensambla un diagrama con aristas locales aún inválidas).
    if state["validation_errors"]:
        return "extract_edges"
    return "synthesize"

def route_after_validate_schema(state: DiagramState) -> str:
    # structural_gaps no-vacío = validate_schema decidió reintentar (hay huecos y
    # queda presupuesto). El tope vive en validate_schema. El type del gap decide
    # destino (S6.8 P5b): algún hueco de "nodes" → extract_nodes (falta un nodo, y
    # en cascada sus aristas); solo "edges" → extract_edges (nodos OK, falta
    # conectarlos). Vacío (limpio o degradado) → fin.
    gaps = state["structural_gaps"]
    if not gaps:
        return END
    if any(g["type"] == "nodes" for g in gaps):
        return "extract_nodes"
    return "extract_edges"


def build_graph(queue: asyncio.Queue | None = None):
    builder = StateGraph(DiagramState)
    builder.add_node("guard", guard)
    builder.add_conditional_edges("guard", route_after_guard)
    builder.add_node("classify", classify)
    builder.add_edge("classify", "extract_nodes")
    builder.add_node("extract_nodes", make_extract_nodes(queue))
    builder.add_node("validate_nodes", validate_nodes)
    builder.add_edge("extract_nodes", "validate_nodes")
    builder.add_conditional_edges("validate_nodes", route_after_validate_nodes)
    builder.add_node("extract_edges", make_extract_edges(queue))
    builder.add_edge("extract_edges", "validate_edges")
    builder.add_node("validate_edges", validate_edges)
    builder.add_conditional_edges("validate_edges", route_after_validate_edges)
    builder.add_node("synthesize", synthesize)
    builder.add_edge("synthesize", "validate_schema")
    builder.add_node("validate_schema", validate_schema)
    builder.add_conditional_edges("validate_schema", route_after_validate_schema)
    builder.set_entry_point("guard")
    return builder.compile()
