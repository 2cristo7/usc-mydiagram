import operator
from typing import TypedDict, Optional, Annotated, Literal
from schemas import DiagramSchema, DiagramNode, DiagramEdge, DiagramType


class StructuralGap(TypedDict):
    """Un hueco estructural del diagrama ENSAMBLADO detectado por validate_schema
    (S6.8). A diferencia de invalid_nodes/invalid_edges (una pieza concreta mal
    hecha que retener), un gap es una CARENCIA del conjunto: falta algo que el
    LLM nunca generó (p. ej. el terminator de inicio de un flowchart).

    `type` codifica DE QUÉ LADO está el hueco y es lo que lee el router
    route_after_validate_schema para decidir destino: "nodes" → reintentar desde
    extract_nodes (falta un nodo, así que también faltarán sus aristas);
    "edges" → reintentar desde extract_edges (los nodos están, falta conectarlos).
    Literal cerrado: un valor mal escrito rompería el routing en silencio."""
    type: Literal["nodes", "edges"]
    reason: str


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
    # Huecos estructurales del diagrama ensamblado, escritos SOLO por
    # validate_schema (S6.8). Replace (sin Annotated): cada pasada recalcula los
    # huecos desde cero sobre el diagrama actual; si la regeneración los rellenó,
    # validate_schema devuelve [] y eso sustituye la lista — debe converger a
    # vacío, no acumular. operator.add sería un bug: gaps ya resueltos
    # reaparecerían y el bucle no terminaría nunca.
    structural_gaps: list[StructuralGap]
    # Presupuesto de reintentos ESTRUCTURALES, independiente de los de nodos
    # (node_retry_count) y aristas (retry_count): un diagrama que gasta su
    # presupuesto regenerando piezas no debe llegar al validador estructural ya
    # sin saldo para rellenar el hueco. Tope en validate_schema.
    schema_retry_count: int
    title: Optional[str]