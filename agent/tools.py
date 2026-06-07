"""S7.2 — Las 9 tools del agente conversacional, como lógica PURA.

"Puro" aquí significa: lógica separable del LLM y del grafo, testeable sin
ninguno de los dos. NO significa inmutable — el `DiagramWorkspace` es mutable a
propósito (ver su docstring). El binding al agente (`bind_tools`/`ToolNode`) es
S7.3; el `interrupt()` de `ask_clarification` es S7.4.

Diseño ReAct: cada tool devuelve una OBSERVACIÓN. En éxito, los datos que pide el
plan (`{"id": ...}`, una lista, `{"ok": True}`); en error, `{"error": "<mensaje
accionable>"}`. El error rico es lo que permite que el AGENTE se autocorrija o
pida aclaración — la tool nunca decide ese siguiente paso, solo informa fielmente.
"""

import re
import unicodedata
from typing import Optional

from pydantic import BaseModel, Field

from schemas import (
    DiagramNode, DiagramEdge, NodeType, EdgeType, DiagramType,
    CompactDiagram, ALLOWED_NODE_TYPES, ALLOWED_EDGE_TYPES,
    node_type_allowed, edge_type_allowed,
)


# ---------------------------------------------------------------------------
# Schemas Pydantic de argumentos
# ---------------------------------------------------------------------------
# Definen el contrato de cada tool. En S7.3 se reusan como `args_schema` al
# registrar las tools con bind_tools (de ahí los Field con description: el LLM los
# lee para saber qué pasar).

class FindNodeArgs(BaseModel):
    query: str = Field(description="Texto a resolver contra los labels/ids de los nodos existentes (p. ej. 'Usuarios')")


class AddNodeArgs(BaseModel):
    node_type: NodeType = Field(description="Tipo de nodo; debe ser válido para el tipo de diagrama")
    label: str = Field(description="Nombre legible del nodo")
    attributes: list[str] = Field(default_factory=list, description="Atributos/campos del nodo")
    methods: list[str] = Field(default_factory=list, description="Métodos (solo UML); se anexan a attributes")


class UpdateNodeArgs(BaseModel):
    id: str = Field(description="id del nodo a modificar")
    label: Optional[str] = Field(default=None, description="Nuevo label, si se cambia")
    node_type: Optional[NodeType] = Field(default=None, description="Nuevo node_type, si se cambia")
    attributes: Optional[list[str]] = Field(default=None, description="Lista de atributos que REEMPLAZA la actual, si se da")


class DeleteNodeArgs(BaseModel):
    id: str = Field(description="id del nodo a borrar (las aristas conectadas se borran en cascada)")


class AddEdgeArgs(BaseModel):
    source: str = Field(description="id del nodo origen (debe existir)")
    target: str = Field(description="id del nodo destino (debe existir)")
    edge_type: EdgeType = Field(description="Tipo de arista; debe ser válido para el tipo de diagrama")
    label: str = Field(default="", description="Etiqueta de la arista, opcional")


class DeleteEdgeArgs(BaseModel):
    # S7.5: id O source+target. La evidencia del smoke test E2E: los modelos
    # locales llaman delete_edge(source, target) sistemáticamente aunque la
    # descripción exija id (qwen3:8b llegó a CREAR una arista para poder
    # borrarla). Aceptar ambas formas elimina esa clase de fallo.
    id: Optional[str] = Field(default=None, description="id de la arista a borrar (si se conoce)")
    source: Optional[str] = Field(default=None, description="id del nodo origen (alternativa: source+target en vez de id)")
    target: Optional[str] = Field(default=None, description="id del nodo destino (alternativa: source+target en vez de id)")


class ApplyLayoutArgs(BaseModel):
    pass  # sin argumentos


class AskClarificationArgs(BaseModel):
    question: str = Field(description="Pregunta a mostrar al usuario")
    options: Optional[list[str]] = Field(default=None, description="Opciones cerradas, se muestran como botones")


class RegenerateArgs(BaseModel):
    prompt: str = Field(description="Descripción para regenerar el diagrama desde cero")
    diagram_type: Optional[DiagramType] = Field(default=None, description="Forzar un tipo de diagrama, opcional")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _slugify(label: str) -> str:
    """Label legible → id slug, espejo de lo que el LLM genera en S6
    ('slug_sin_espacios'). Sin acentos, minúsculas, no alfanumérico → '_'."""
    norm = unicodedata.normalize("NFKD", label).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "_", norm.lower()).strip("_")
    return slug or "nodo"


def _allowed_nodes_str(dt: DiagramType) -> str:
    allowed = ALLOWED_NODE_TYPES.get(dt)
    return ", ".join(sorted(t.value for t in allowed)) if allowed else "(cualquiera)"


def _allowed_edges_str(dt: DiagramType) -> str:
    allowed = ALLOWED_EDGE_TYPES.get(dt)
    return ", ".join(sorted(t.value for t in allowed)) if allowed else "(cualquiera)"


# ---------------------------------------------------------------------------
# Workspace mutable
# ---------------------------------------------------------------------------

class DiagramWorkspace:
    """Estado mutable del diagrama durante un refinamiento (S7.2).

    Las tools operan sobre ESTA instancia: `add_node` seguido de `find_node` ve lo
    que la primera añadió. Es deliberadamente mutable y vive en el camino de
    REFINAMIENTO, distinto del pipeline de generación S6 (append-only/streaming,
    que nunca retracta). Aquí el usuario edita un diagrama YA confirmado, así que
    borrar y actualizar es legítimo: el invariante "solo se añade" gobierna el
    streaming de una generación, no la edición posterior.
    """

    def __init__(self, diagram_type: DiagramType, nodes: list[DiagramNode], edges: list[DiagramEdge]):
        self.diagram_type = diagram_type
        self.nodes: list[DiagramNode] = list(nodes)
        self.edges: list[DiagramEdge] = list(edges)

    @classmethod
    def from_compact(cls, d: CompactDiagram) -> "DiagramWorkspace":
        return cls(d.diagram_type, d.nodes, d.edges)

    def to_compact(self) -> CompactDiagram:
        return CompactDiagram(diagram_type=self.diagram_type, nodes=self.nodes, edges=self.edges)

    # --- helpers internos ---
    def _node(self, node_id: str) -> Optional[DiagramNode]:
        return next((n for n in self.nodes if n.id == node_id), None)

    def _edge(self, edge_id: str) -> Optional[DiagramEdge]:
        return next((e for e in self.edges if e.id == edge_id), None)

    def _fresh_node_id(self, label: str) -> str:
        base = _slugify(label)
        existing = {n.id for n in self.nodes}
        if base not in existing:
            return base
        i = 2
        while f"{base}_{i}" in existing:
            i += 1
        return f"{base}_{i}"

    def _fresh_edge_id(self, source: str, target: str) -> str:
        base = f"{source}__{target}"
        existing = {e.id for e in self.edges}
        if base not in existing:
            return base
        i = 2
        while f"{base}_{i}" in existing:
            i += 1
        return f"{base}_{i}"

    # --- tools ---
    def find_node(self, query: str) -> list[dict]:
        """Resuelve un texto al/los nodo(s) existentes. Substring primero (más
        preciso); si no hay, fuzzy con difflib. Devuelve [{id, label, type}]."""
        q = query.strip().lower()
        matches = [n for n in self.nodes if q in n.label.lower() or q in n.id.lower()]
        if not matches:
            from difflib import get_close_matches
            label_by_lower = {n.label.lower(): n for n in self.nodes}
            close = get_close_matches(q, list(label_by_lower), n=5, cutoff=0.6)
            matches = [label_by_lower[c] for c in close]
        return [{"id": n.id, "label": n.label, "type": n.node_type.value} for n in matches]

    def add_node(self, node_type: NodeType, label: str,
                 attributes: Optional[list[str]] = None, methods: Optional[list[str]] = None) -> dict:
        if not node_type_allowed(self.diagram_type, node_type):
            return {"error": f"node_type '{node_type.value}' no es válido para un diagrama '{self.diagram_type.value}'. "
                             f"Tipos válidos: {_allowed_nodes_str(self.diagram_type)}."}
        node_id = self._fresh_node_id(label)
        # methods (UML) se codifican como atributos con '(...)': el frontend ya los
        # distingue por regex (S5.4). Un solo campo `attributes` en el schema.
        attrs = list(attributes or []) + list(methods or [])
        self.nodes.append(DiagramNode(id=node_id, label=label, node_type=node_type, attributes=attrs))
        return {"id": node_id}

    def update_node(self, id: str, label: Optional[str] = None,
                    node_type: Optional[NodeType] = None, attributes: Optional[list[str]] = None) -> dict:
        node = self._node(id)
        if node is None:
            return {"error": f"No existe ningún nodo con id '{id}'. Usa find_node para resolver el nombre."}
        if node_type is not None and not node_type_allowed(self.diagram_type, node_type):
            return {"error": f"node_type '{node_type.value}' no es válido para '{self.diagram_type.value}'. "
                             f"Tipos válidos: {_allowed_nodes_str(self.diagram_type)}."}
        if label is not None:
            node.label = label
        if node_type is not None:
            node.node_type = node_type
        if attributes is not None:
            node.attributes = attributes
        return {"ok": True, "id": id}

    def delete_node(self, id: str) -> dict:
        node = self._node(id)
        if node is None:
            return {"error": f"No existe ningún nodo con id '{id}'."}
        # Cascade: una arista a un nodo borrado quedaría huérfana → se borran sus
        # aristas conectadas. Devolver cuáles es observación útil para el agente.
        deleted_edges = [e.id for e in self.edges if e.source == id or e.target == id]
        self.edges = [e for e in self.edges if e.source != id and e.target != id]
        self.nodes = [n for n in self.nodes if n.id != id]
        return {"ok": True, "deleted_node": id, "deleted_edges": deleted_edges}

    def add_edge(self, source: str, target: str, edge_type: EdgeType, label: str = "") -> dict:
        # Las aristas NUNCA crean nodos (visión-global §3, S6.5c): si falta un
        # extremo, error accionable y el AGENTE decide (add_node antes, o
        # ask_clarification si es ambiguo). La tool no auto-crea ni adivina.
        missing = [x for x in (source, target) if self._node(x) is None]
        if missing:
            return {"error": f"No existe(n) el/los nodo(s) {missing}. add_edge no crea nodos: "
                             f"créalos con add_node o resuélvelos con find_node primero."}
        if not edge_type_allowed(self.diagram_type, edge_type):
            return {"error": f"edge_type '{edge_type.value}' no es válido para '{self.diagram_type.value}'. "
                             f"Tipos válidos: {_allowed_edges_str(self.diagram_type)}."}
        edge_id = self._fresh_edge_id(source, target)
        self.edges.append(DiagramEdge(id=edge_id, source=source, target=target, label=label, edge_type=edge_type))
        return {"id": edge_id}

    def delete_edge(self, id: Optional[str] = None,
                    source: Optional[str] = None, target: Optional[str] = None) -> dict:
        # Resolución por source+target (S7.5): la tool RESUELVE como find_node;
        # ante ambigüedad informa los candidatos y el agente decide (no adivina).
        # Se acepta cualquier dirección: el usuario no distingue source de target.
        if id is None:
            if not (source and target):
                return {"error": "Indica el id de la arista, o bien source y target."}
            matches = [e for e in self.edges if {e.source, e.target} == {source, target}]
            if not matches:
                return {"error": f"No existe ninguna arista entre '{source}' y '{target}'."}
            if len(matches) > 1:
                ids = [e.id for e in matches]
                return {"error": f"Hay {len(matches)} aristas entre '{source}' y '{target}': {ids}. "
                                 f"Repite delete_edge indicando el id concreto."}
            id = matches[0].id
        if self._edge(id) is None:
            return {"error": f"No existe ninguna arista con id '{id}'."}
        self.edges = [e for e in self.edges if e.id != id]
        return {"ok": True, "deleted_edge": id}

    def apply_layout(self) -> dict:
        # FRONTERA S7.2: dagre vive en el FRONTEND y se recalcula en CADA render
        # (DiagramToFlow). El servidor no posiciona nada → esta tool es no-op/señal.
        # Solo tendría trabajo propio si el frontend persistiera posiciones manuales
        # del usuario (deuda futura); hoy ni guarda coordenadas.
        return {"ok": True, "note": "El layout lo recalcula el frontend (dagre) en cada render."}

    def ask_clarification(self, question: str, options: Optional[list[str]] = None) -> dict:
        # FRONTERA S7.2 → S7.4: la PAUSA real es interrupt() de LangGraph, un
        # mecanismo del GRAFO, no de una función pura. Aquí solo se devuelve la
        # intención; el nodo del grafo en S7.4 la traduce a interrupt().
        return {"_interrupt": "clarification", "question": question, "options": options or []}

    def regenerate_from_scratch(self, prompt: str, diagram_type: Optional[DiagramType] = None) -> dict:
        # FRONTERA S7.2 → S7.3: invocar el pipeline de generación S6 completo se
        # cablea al ensamblar el grafo del agente. Aquí solo se señala la intención.
        return {"_regenerate": True, "prompt": prompt,
                "diagram_type": diagram_type.value if diagram_type else None}
