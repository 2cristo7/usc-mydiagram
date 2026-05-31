import operator
from typing import TypedDict, Optional, Annotated
from schemas import DiagramSchema, DiagramNode, DiagramEdge, DiagramType

class DiagramState(TypedDict):
    prompt: str
    is_diagram_request: bool
    diagram_type: Optional[DiagramType]
    # Reducer operator.add (simétrico a edges, S6.7): la pasada de feedback de
    # extract_nodes devuelve SOLO los nodos recién corregidos; LangGraph los
    # concatena a los ya válidos. Solo se streamean válidos → nunca se retractan.
    nodes: Annotated[list[DiagramNode], operator.add]
    # Nodos inválidos retenidos (Pydantic-inválidos o node_type no permitido),
    # pendientes de regenerar. Cada elemento: {"raw": <dict crudo>, "reason": <str>}.
    # Replace (sin Annotated): cada pasada de feedback devuelve los que SIGUEN
    # inválidos, sustituyendo la lista anterior — debe menguar, no crecer.
    invalid_nodes: list[dict]
    # Presupuesto de reintentos de NODOS, independiente del de aristas
    # (retry_count): un fallo de nodos no debe agotar el bucle de aristas.
    node_retry_count: int
    # Señal de routing del bucle de nodos (mirror de validation_errors para
    # aristas): no-vacío → validate_nodes pidió reintentar → router vuelve a
    # extract_nodes; vacío → seguir a extract_edges. El tope de reintentos vive
    # en validate_nodes; el router solo refleja la decisión leyendo este campo.
    node_validation_errors: list[str]
    # Reducer operator.add: cada pasada de extract_edges devuelve SOLO las aristas
    # nuevas/recién arregladas; LangGraph las concatena a las ya válidas. Nunca se
    # retractan, así que no hace falta poder reemplazar.
    edges: Annotated[list[DiagramEdge], operator.add]
    # Aristas inválidas retenidas pendientes de regenerar — representación
    # uniforme {"raw": <dict crudo>, "reason": <str>} (S6.7, espejo de invalid_nodes),
    # que cubre las TRES clases de fallo de arista: huérfana (referencia a nodo
    # inexistente), semántica (edge_type no permitido) y Pydantic (schema inválido).
    # Replace (sin Annotated): cada pasada de feedback devuelve las que SIGUEN rotas.
    invalid_edges: list[dict]
    diagram: Optional[DiagramSchema]
    validation_errors: list[str]
    retry_count: int
    title: Optional[str]