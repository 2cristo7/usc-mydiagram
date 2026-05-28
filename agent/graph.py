from langgraph.graph import StateGraph, END
from state import DiagramState
from nodes.guard import guard
from nodes.classify import classify
from nodes.extract_nodes import extract_nodes
from nodes.extract_relations import extract_relations
from nodes.synthesize import synthesize
from nodes.validate import validate

  
def route_after_guard(state: DiagramState) -> str:
    return "classify" if state["is_diagram_request"] else END

builder = StateGraph(DiagramState)
builder.add_node("guard", guard)
builder.add_conditional_edges("guard", route_after_guard)
builder.add_node("classify", classify)
builder.add_edge("classify", "extract_nodes")
builder.add_node("extract_nodes", extract_nodes)
builder.add_edge("extract_nodes", "extract_relations")
builder.add_node("extract_relations", extract_relations)
builder.add_edge("extract_relations", "synthesize")
builder.add_node("synthesize", synthesize)
builder.add_edge("synthesize", END)
builder.add_node("validate", validate)
builder.add_edge("validate", END)
builder.set_entry_point("guard")

graph = builder.compile()