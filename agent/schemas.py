from pydantic import BaseModel, Field
from enum import Enum

class DiagramType(str, Enum):
    ERD           = "erd"
    UML_CLASS     = "uml_class"
    SEQUENCE      = "sequence"
    FLOWCHART     = "flowchart"
    ARCHITECTURE  = "architecture"
    STATE_MACHINE = "state_machine"
    MINDMAP       = "mindmap"


class NodeType(str, Enum):
    TABLE    = "table"      # ERD
    CLASS    = "class"      # UML clase
    ACTOR    = "actor"      # secuencia / casos de uso
    STEP     = "step"       # flowchart
    SERVICE  = "service"    # arquitectura
    DATABASE = "database"   # arquitectura
    QUEUE    = "queue"      # arquitectura
    GATEWAY  = "gateway"    # arquitectura
    STATE    = "state"      # máquina de estados
    TOPIC    = "topic"      # mindmap
    PERSON   = "person"     # C4
    SYSTEM   = "system"     # C4
    CONTAINER = "container"  # C4
    COMPONENT = "component"  # C4


class EdgeType(str, Enum):
    ONE_TO_MANY  = "one_to_many"
    MANY_TO_MANY = "many_to_many"
    ONE_TO_ONE   = "one_to_one"
    INHERITS     = "inherits"
    IMPLEMENTS   = "implements"
    CALLS        = "calls"
    SEQUENCE     = "sequence"    # mensaje en diagrama de secuencia
    TRANSITION   = "transition"  # máquina de estados
    DEPENDS_ON   = "depends_on"
    ASSOCIATION  = "association"

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