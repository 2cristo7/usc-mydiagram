from state import DiagramState


async def validate(state: DiagramState) -> DiagramState:
    diagram = state.get("diagram")
    if not diagram:
        return {"validation_errors": ["No diagram to validate"], "retry_count": state["retry_count"] + 1}

    if diagram.edges and diagram.nodes:
        node_ids = {n.id for n in diagram.nodes}
        for edge in diagram.edges:
            if edge.source not in node_ids or edge.target not in node_ids:
                return {"validation_errors": ["Edge references non-existent node"], "retry_count": state["retry_count"] + 1}

    return {"validation_errors": []}
