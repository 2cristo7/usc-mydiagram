from pydantic import BaseModel, Field
from enum import Enum

class DiagramType(str, Enum):
    ERD          = "erd"
    SEQUENCE     = "sequence"
    FLOWCHART    = "flowchart"
    ARCHITECTURE = "architecture"
    MINDMAP      = "mindmap"
    USE_CASE     = "use_case"


class NodeType(str, Enum):
    TABLE      = "table"       # ERD
    ACTOR      = "actor"       # secuencia / casos de uso (monigote)
    STEP       = "step"        # flowchart
    SERVICE    = "service"     # arquitectura
    DATABASE   = "database"    # arquitectura
    QUEUE      = "queue"       # arquitectura
    GATEWAY    = "gateway"     # arquitectura
    TOPIC      = "topic"       # mindmap
    DECISION   = "decision"    # flowchart (rombo de bifurcación)
    TERMINATOR = "terminator"  # flowchart (inicio/fin)
    PERSON     = "person"      # C4
    SYSTEM     = "system"      # C4 / casos de uso (caja de subsistema)
    CONTAINER  = "container"   # C4
    COMPONENT  = "component"   # C4
    USE_CASE   = "use_case"    # casos de uso (óvalo)


class EdgeType(str, Enum):
    ONE_TO_MANY  = "one_to_many"
    MANY_TO_MANY = "many_to_many"
    ONE_TO_ONE   = "one_to_one"
    INHERITS     = "inherits"    # herencia UML / generalización de actores (triángulo hueco)
    CALLS        = "calls"
    SEQUENCE     = "sequence"    # mensaje de llamada en secuencia (sólido, flecha rellena)
    SEQUENCE_REPLY = "sequence_reply"  # respuesta/retorno en secuencia (discontinua, flecha abierta)
    DEPENDS_ON   = "depends_on"
    ASSOCIATION  = "association" # línea sólida actor↔caso de uso / mindmap
    FLOW         = "flow"        # flowchart (encadenado simple entre pasos)
    CONDITIONAL  = "conditional" # flowchart (rama de un decision, label sí/no)
    INCLUDE      = "include"     # casos de uso (discontinua, estereotipo «include»)
    EXTEND       = "extend"      # casos de uso (discontinua, estereotipo «extend»)

class DiagramNode(BaseModel):
    id: str
    label: str
    node_type: NodeType
    attributes: list[str] = Field(default_factory=list)


class DiagramEdge(BaseModel):
    id: str
    source: str
    target: str
    label: str
    edge_type: EdgeType


# ---------------------------------------------------------------------------
# Fragmentos combinados de diagrama de secuencia (S10.4)
# ---------------------------------------------------------------------------
# Un fragmento (UML CombinedFragment) NO es ni nodo ni arista: es una TERCERA
# entidad que envuelve un rango ORDENADO de mensajes (edges) con una semántica de
# control de flujo. Por eso vive en su propio array top-level (`fragments`) y no
# en `attributes` de un nodo (el patrón de los grupos de arquitectura no sirve:
# allí se agrupan nodos por etiqueta; aquí se agrupan aristas por posición).
#
# `alt` tiene VARIOS operandos (if/else: cada rama con su guarda); `opt`/`loop`/
# una región de `par` tienen uno solo. Los fragmentos ANIDAN: un operando puede
# contener fragmentos hijos por referencia explícita (`child_fragment_ids`), no
# por contención de rangos inferida (ambigua cuando comparten extremos).
class FragmentKind(str, Enum):
    ALT  = "alt"   # alternativas mutuamente excluyentes (if / else if / else)
    OPT  = "opt"   # bloque opcional (un solo operando con guarda)
    LOOP = "loop"  # iteración (guarda = condición/contador del bucle)
    PAR  = "par"   # regiones concurrentes (cada operando corre en paralelo)


class FragmentOperand(BaseModel):
    # `guard`: la condición entre corchetes ("[saldo > 0]", "[else]", "[para cada item]").
    guard: str = ""
    # Mensajes (edge ids) directamente contenidos en este operando, en orden.
    message_ids: list[str] = Field(default_factory=list)
    # Fragmentos anidados dentro de este operando, por id (referencia explícita).
    child_fragment_ids: list[str] = Field(default_factory=list)


class Fragment(BaseModel):
    id: str
    kind: FragmentKind
    operands: list[FragmentOperand] = Field(default_factory=list)


class DiagramSchema(BaseModel):
    title: str
    diagram_type: DiagramType
    nodes: list[DiagramNode]
    edges: list[DiagramEdge]
    # Solo lo usan los diagramas de secuencia; opcional (default []) → un diagrama
    # sin fragmentos es exactamente el comportamiento previo a S10.4.
    fragments: list[Fragment] = Field(default_factory=list)


# S7.1 — Representación compacta que el frontend envía al refinar. Espejo del
# CompactDiagram de TS (frontend/src/ui/utils/diagramToJson.ts): el contrato que
# cruza el proceso al refinar es ESTE, no DiagramSchema. Sin `title` (human-facing,
# no aporta al refinamiento). Validar aquí con Pydantic da el "error explícito" de
# la visión global: un diagrama malformado en el refinamiento → 422, no fallo mudo.
class CompactDiagram(BaseModel):
    diagram_type: DiagramType
    nodes: list[DiagramNode]
    edges: list[DiagramEdge]
    # S10.4 — los fragmentos de secuencia viajan también al refinar para que el
    # agente los conserve / razone sobre ellos. Opcional: el resto de tipos no lo trae.
    fragments: list[Fragment] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Validación semántica por tipo (S6.7)
# ---------------------------------------------------------------------------
# Fuente de verdad de QUÉ node_type/edge_type es válido para cada DiagramType.
# Es la versión-datos de la guía que la prosa de prompts.py da al LLM: ambos
# deben beber de aquí para no contradecirse (el prompt dice qué usar, este mapa
# valida que se haya usado). Un JSON puede ser Pydantic-válido (tipo dentro del
# enum global) pero semánticamente inválido para su diagrama (p. ej. un
# edge_type "one_to_many" en un flowchart).
#
# Registro PARCIAL a propósito: un DiagramType sin entrada aquí NO se valida
# semánticamente (se acepta cualquier tipo del enum). Así, si en S7 se añade un
# DiagramType nuevo y se olvida registrarlo, el sistema degrada a "solo
# Pydantic" en vez de rechazar todos sus diagramas. Fallar hacia permisivo, no
# hacia roto. La consulta se hace con `.get(dt)` en validate_nodes/edges.
ALLOWED_NODE_TYPES: dict[DiagramType, set[NodeType]] = {
    DiagramType.ERD:          {NodeType.TABLE},
    DiagramType.SEQUENCE:     {NodeType.ACTOR},
    DiagramType.FLOWCHART:    {NodeType.TERMINATOR, NodeType.STEP, NodeType.DECISION},
    DiagramType.ARCHITECTURE: {
        NodeType.SERVICE, NodeType.DATABASE, NodeType.QUEUE, NodeType.GATEWAY,
        NodeType.PERSON, NodeType.SYSTEM, NodeType.CONTAINER, NodeType.COMPONENT,
    },
    DiagramType.MINDMAP:      {NodeType.TOPIC},
    DiagramType.USE_CASE:     {NodeType.ACTOR, NodeType.USE_CASE, NodeType.SYSTEM},
}

ALLOWED_EDGE_TYPES: dict[DiagramType, set[EdgeType]] = {
    DiagramType.ERD:          {EdgeType.ONE_TO_ONE, EdgeType.ONE_TO_MANY, EdgeType.MANY_TO_MANY},
    DiagramType.SEQUENCE:     {EdgeType.SEQUENCE, EdgeType.SEQUENCE_REPLY},
    DiagramType.FLOWCHART:    {EdgeType.FLOW, EdgeType.CONDITIONAL},
    DiagramType.ARCHITECTURE: {EdgeType.CALLS, EdgeType.DEPENDS_ON},
    DiagramType.MINDMAP:      {EdgeType.ASSOCIATION},
    DiagramType.USE_CASE:     {EdgeType.ASSOCIATION, EdgeType.INCLUDE, EdgeType.EXTEND, EdgeType.INHERITS},
}


def node_type_allowed(diagram_type: DiagramType, node_type: NodeType) -> bool:
    """¿Es `node_type` semánticamente válido para `diagram_type`?

    Fallback permisivo (S6.7, P4-b): si el tipo de diagrama no está registrado,
    se acepta cualquier node_type del enum (degrada a solo-Pydantic) en vez de
    rechazar todo. Fallar hacia permisivo, no hacia roto."""
    allowed = ALLOWED_NODE_TYPES.get(diagram_type)
    return allowed is None or node_type in allowed


def edge_type_allowed(diagram_type: DiagramType, edge_type: EdgeType) -> bool:
    """¿Es `edge_type` semánticamente válido para `diagram_type`? Gemela de
    `node_type_allowed`; mismo fallback permisivo."""
    allowed = ALLOWED_EDGE_TYPES.get(diagram_type)
    return allowed is None or edge_type in allowed


def validate_fragment(
    frag: Fragment, valid_edge_ids: set[str], valid_fragment_ids: set[str]
) -> tuple[bool, str]:
    """¿Es `frag` referencialmente coherente? Como en las aristas (integridad
    referencial), un fragmento que apunta a un mensaje o a un hijo inexistente
    dejaría un marco fantasma sin contenido en el canvas. Se valida —no se corrige
    en bucle como nodos/aristas (S10.4): los fragmentos son decoración estructural,
    así que un fragmento inválido se DESCARTA (degradación limpia), no se reintenta.

    Reglas: kind con ≥1 operando; alt con ≥2; cada message_id y cada
    child_fragment_id deben existir. Devuelve (ok, motivo)."""
    if not frag.operands:
        return False, "fragmento sin operandos"
    if frag.kind == FragmentKind.ALT and len(frag.operands) < 2:
        return False, "alt requiere al menos 2 operandos (rama y alternativa)"
    for op in frag.operands:
        for mid in op.message_ids:
            if mid not in valid_edge_ids:
                return False, f'mensaje inexistente referenciado: "{mid}"'
        for cid in op.child_fragment_ids:
            if cid not in valid_fragment_ids:
                return False, f'fragmento hijo inexistente referenciado: "{cid}"'
        if not op.message_ids and not op.child_fragment_ids:
            return False, "operando vacío (sin mensajes ni fragmentos hijos)"
    return True, ""