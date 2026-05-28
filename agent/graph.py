from langgraph.graph import StateGraph, END
from state import DiagramState
from nodes.guard import guard
from nodes.classify import classify
from nodes.extract import extract
from nodes.synthesize import synthesize
from nodes.validate import validate


def route_after_guard(state: DiagramState) -> str:
    return "classify" if state["is_diagram_request"] else END

builder = StateGraph(DiagramState)
builder.add_node("guard", guard)
builder.add_conditional_edges("guard", route_after_guard)
builder.add_node("classify", classify)
builder.add_edge("classify", END)
builder.add_node("extract", extract)
builder.add_edge("extract", END)
builder.add_node("synthesize", synthesize)
builder.add_edge("synthesize", END)
builder.add_node("validate", validate)
builder.add_edge("validate", END)
builder.set_entry_point("guard")

graph = builder.compile()