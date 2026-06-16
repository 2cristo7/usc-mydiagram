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
    SEQUENCE     = "sequence"    # mensaje en diagrama de secuencia
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


class DiagramSchema(BaseModel):
    title: str
    diagram_type: DiagramType
    nodes: list[DiagramNode]
    edges: list[DiagramEdge]


# S7.1 — Representación compacta que el frontend envía al refinar. Espejo del
# CompactDiagram de TS (frontend/src/ui/utils/diagramToJson.ts): el contrato que
# cruza el proceso al refinar es ESTE, no DiagramSchema. Sin `title` (human-facing,
# no aporta al refinamiento). Validar aquí con Pydantic da el "error explícito" de
# la visión global: un diagrama malformado en el refinamiento → 422, no fallo mudo.
class CompactDiagram(BaseModel):
    diagram_type: DiagramType
    nodes: list[DiagramNode]
    edges: list[DiagramEdge]


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
    DiagramType.SEQUENCE:     {EdgeType.SEQUENCE},
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