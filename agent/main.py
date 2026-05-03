from fastapi import FastAPI
from pydantic import BaseModel
from enum import Enum

app = FastAPI()

@app.get("/health")
def health():
    return {"status": "ok", "service": "agent"}


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
    STATE    = "state"      # máquina de estados
    TOPIC    = "topic"      # mindmap


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
    attributes: list[str]


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
