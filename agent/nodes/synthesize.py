from state import DiagramState
from schemas import DiagramSchema

async def synthesize(state: DiagramState) -> DiagramState:
    nodes = state.get("nodes", [])
    edges = state.get("edges", [])
    diagram_type = state.get("diagram_type")
    title = state.get("title", "Untitled Diagram")

    diagram = DiagramSchema(
      title=title,
      diagram_type=diagram_type,
      nodes=nodes,
      edges=edges,
    )

    return {"diagram": diagram}
