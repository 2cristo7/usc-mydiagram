from typing import TypedDict, Optional
from schemas import DiagramSchema, DiagramNode, DiagramEdge, DiagramType

class DiagramState(TypedDict):
    prompt: str
    is_diagram_request: bool
    diagram_type: Optional[DiagramType]
    nodes: list[DiagramNode]
    edges: list[DiagramEdge]
    diagram: Optional[DiagramSchema]
    validation_errors: list[str]
    retry_count: int