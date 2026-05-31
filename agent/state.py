import operator
from typing import TypedDict, Optional, Annotated
from schemas import DiagramSchema, DiagramNode, DiagramEdge, DiagramType

class DiagramState(TypedDict):
    prompt: str
    is_diagram_request: bool
    diagram_type: Optional[DiagramType]
    nodes: list[DiagramNode]
    # Reducer operator.add: cada pasada de extract_edges devuelve SOLO las aristas
    # nuevas/recién arregladas; LangGraph las concatena a las ya válidas. Nunca se
    # retractan, así que no hace falta poder reemplazar.
    edges: Annotated[list[DiagramEdge], operator.add]
    # Huérfanas retenidas pendientes de regenerar. Replace (sin Annotated): cada
    # pasada de feedback devuelve las que SIGUEN rotas, sustituyendo la lista anterior.
    orphan_edges: list[DiagramEdge]
    diagram: Optional[DiagramSchema]
    validation_errors: list[str]
    retry_count: int
    title: Optional[str]