import asyncio
from langgraph.graph import StateGraph, END
from state import DiagramState
from nodes.guard import guard
from nodes.classify import classify
from nodes.extract_nodes import make_extract_nodes
from nodes.extract_edges import make_extract_edges
from nodes.synthesize import synthesize
from nodes.validate import validate


def route_after_guard(state: DiagramState) -> str:
    return "classify" if state["is_diagram_request"] else END

def route_after_validate(state: DiagramState) -> str:
    if state["validation_errors"] and state["retry_count"] < 3:
        return "synthesize"
    return END


def build_graph(queue: asyncio.Queue | None = None):
    builder = StateGraph(DiagramState)
    builder.add_node("guard", guard)
    builder.add_conditional_edges("guard", route_after_guard)
    builder.add_node("classify", classify)
    builder.add_edge("classify", "extract_nodes")
    builder.add_node("extract_nodes", make_extract_nodes(queue))
    builder.add_edge("extract_nodes", "extract_edges")
    builder.add_node("extract_edges", make_extract_edges(queue))
    builder.add_edge("extract_edges", "synthesize")
    builder.add_node("synthesize", synthesize)
    builder.add_edge("synthesize", "validate")
    builder.add_node("validate", validate)
    builder.add_conditional_edges("validate", route_after_validate)
    builder.set_entry_point("guard")
    return builder.compile()
