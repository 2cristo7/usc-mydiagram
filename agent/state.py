import operator
from typing import TypedDict, Optional, Annotated, Literal
from schemas import DiagramSchema, DiagramNode, DiagramEdge, DiagramType, Fragment


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


class Degradation(TypedDict):
    """Una degradación CONSUMADA del diagrama final (S6.9): un branch de rendición
    (validate_nodes/validate_edges/validate_schema) agotó su presupuesto y dejó
    algo sin resolver. A diferencia de invalid_*/structural_gaps —canales de
    routing que DEBEN vaciarse para que el bucle pare (si no, bucle infinito: el
    router decide por lista no vacía, no por contador)— esto es un registro que
    debe SOBREVIVIR hasta el END para que classify_outcome construya el aviso
    accionable. Por eso vive en su propio canal con reducer operator.add.

    `category` codifica QUÉ dimensión se degradó (la taxonomía de S6.9):
    "nodes" (nodos descartados), "edges" (relaciones sin resolver), "structure"
    (carencia estructural del ensamblado). `reasons` son los motivos por pieza,
    ya accionables, que produjeron los validadores locales."""
    category: Literal["nodes", "edges", "structure"]
    reasons: list[str]


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
    # S10.4 — fragmentos combinados (alt/opt/loop/par) de un diagrama de secuencia.
    # Replace (sin Annotated): extract_fragments es UNA pasada sin feedback; cada
    # ejecución recalcula la lista entera desde los mensajes actuales. Vacío para
    # cualquier tipo que no sea secuencia.
    fragments: list[Fragment]
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
    # Degradaciones consumadas (S6.9): cada branch de rendición que agota su
    # presupuesto añade aquí su {category, reasons}. Reducer operator.add —al
    # contrario que invalid_*/structural_gaps (replace, deben converger a vacío)—
    # porque estas entradas deben ACUMULARSE y sobrevivir al END: son la fuente de
    # verdad de classify_outcome para distinguir done-limpio de done-degradado y
    # construir el aviso por categoría. Los branches usan guarda de idempotencia
    # (no re-añadir su categoría) para el caso en que el bucle estructural reentre
    # por un validador local ya agotado.
    degradations: Annotated[list[Degradation], operator.add]
    title: Optional[str]
    # S10.3 — Desambiguación de tipo en generación: cuando el usuario pide un
    # diagrama UML/de comportamiento de forma genérica sin especificar secuencia
    # vs casos de uso, classify emite un evento `type_clarification` y activa
    # este flag. El grafo corta a END limpiamente (sin generar nodos ni emitir
    # `error`/`done`). El frontend lee el evento y re-lanza con el tipo ya fijado.
    needs_type_clarification: bool
    # Runtime LLM per-request (S10.x). None → los nodos caen a env-based (_resolve_model).
    # No usa Annotated: el runtime es un objeto singleton por petición, no acumulable;
    # el último escritor gana (semántica replace). Tipado como object para evitar
    # import circular entre state.py y llm.py.
    llm: Optional[object]