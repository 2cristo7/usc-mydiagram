"""Validación ESTRUCTURAL del diagrama ensamblado (S6.8).

Complementa las validaciones LOCALES previas:
- schemas.py valida cada nodo/arista contra su tipo permitido (semántica por pieza).
- extract_edges valida integridad referencial (aristas huérfanas, pieza a pieza).
Aquí se valida el diagrama como CONJUNTO: puede tener todos sus elementos válidos
por separado y aun así ser estructuralmente inválido (flowchart sin nodo de
inicio, componentes desconectados, mindmap sin raíz única).

Cada regla, al fallar, produce un StructuralGap {type, reason}: una CARENCIA del
conjunto, no una pieza mal hecha. El `type` ("nodes"/"edges") indica desde dónde
debe regenerar el bucle de relleno (lo lee route_after_validate_schema):
- "nodes": falta un nodo → reintentar desde extract_nodes (y, en cascada, sus aristas).
- "edges": los nodos están, falta conectarlos → reintentar desde extract_edges.

Registro PARCIAL a propósito (espejo de ALLOWED_* en schemas.py): un DiagramType
sin validador registrado NO se valida estructuralmente. Fallar hacia permisivo,
no hacia roto — si S7 añade un tipo y olvida sus reglas, degrada a "solo Pydantic
+ semántica" en vez de bloquear todos sus diagramas.

S6.8 arranca solo con el validador de flowchart (el caso del criterio); los demás
tipos quedan en fallback permisivo hasta que se valide el mecanismo end-to-end.
"""
from collections.abc import Callable

from schemas import DiagramNode, DiagramEdge, DiagramType, NodeType
from state import StructuralGap


# ---------------------------------------------------------------------------
# Helpers reutilizables entre tipos
# ---------------------------------------------------------------------------
# Viven aquí, no dentro de cada validador, para que reglas comunes (huérfanos,
# conteo por tipo, conectividad) no se reimplementen —y diverjan— en cada tipo.

def find_orphan_nodes(nodes: list[DiagramNode], edges: list[DiagramEdge]) -> list[DiagramNode]:
    """Nodos que no participan en ninguna arista (ni como source ni como target).

    Un huérfano es señal de extracción incompleta: falta la relación que lo
    conecta. Es legítimo solo en tipos sin validador estructural (p. ej. un
    mindmap de un único tema), que por eso no llaman aquí."""
    connected = {e.source for e in edges} | {e.target for e in edges}
    return [n for n in nodes if n.id not in connected]


def count_node_type(nodes: list[DiagramNode], node_type: NodeType) -> int:
    """Cuántos nodos del diagrama son de `node_type`."""
    return sum(1 for n in nodes if n.node_type == node_type)


def in_degree(node_id: str, edges: list[DiagramEdge]) -> int:
    """Número de aristas que ENTRAN al nodo (lo tienen como target)."""
    return sum(1 for e in edges if e.target == node_id)


def out_degree(node_id: str, edges: list[DiagramEdge]) -> int:
    """Número de aristas que SALEN del nodo (lo tienen como source)."""
    return sum(1 for e in edges if e.source == node_id)


def find_unreachable_nodes(
    nodes: list[DiagramNode], edges: list[DiagramEdge], seeds: list[str]
) -> list[DiagramNode]:
    """Nodos no alcanzables desde `seeds` recorriendo el grafo como NO dirigido.

    Mide conectividad: si tras un BFS no dirigido desde las semillas quedan nodos
    sin visitar, son grupos aislados del resto del diagrama (faltan aristas que
    los enlacen). Se trata no dirigido porque la conectividad estructural no
    depende del sentido del flujo."""
    adj: dict[str, set[str]] = {n.id: set() for n in nodes}
    for e in edges:
        if e.source in adj and e.target in adj:
            adj[e.source].add(e.target)
            adj[e.target].add(e.source)
    seen: set[str] = set()
    stack = list(seeds)
    while stack:
        cur = stack.pop()
        if cur in seen:
            continue
        seen.add(cur)
        stack.extend(adj[cur] - seen)
    return [n for n in nodes if n.id not in seen]


# ---------------------------------------------------------------------------
# Validadores por tipo
# ---------------------------------------------------------------------------

def _validate_flowchart(nodes: list[DiagramNode], edges: list[DiagramEdge]) -> list[StructuralGap]:
    """Reglas estructurales de un flowchart:
    - (B) Un terminator de INICIO: in-degree 0 y out-degree ≥1. El ≥1 evita que
      un terminator aislado cuente como inicio (ese caso lo captura D/E).
    - (C) Un terminator de FIN: out-degree 0 y in-degree ≥1.
    - (D) Ningún nodo huérfano (grado 0): falta la relación que lo conecta.
    - (E) Conexo: todo nodo alcanzable desde el inicio; un grupo aislado son
      aristas que faltan. Excluye huérfanos (ya reportados por D) para no duplicar.

    Cero terminators dispara B y C a la vez (faltan inicio y fin): correcto, el
    relleno debe añadir ambos."""
    gaps: list[StructuralGap] = []
    terminators = [n for n in nodes if n.node_type == NodeType.TERMINATOR]

    starts = [n for n in terminators if in_degree(n.id, edges) == 0 and out_degree(n.id, edges) >= 1]
    if not starts:
        gaps.append({
            "type": "nodes",
            "reason": "el flowchart no tiene un nodo 'terminator' de inicio (sin aristas entrantes y con al menos una saliente)",
        })

    ends = [n for n in terminators if out_degree(n.id, edges) == 0 and in_degree(n.id, edges) >= 1]
    if not ends:
        gaps.append({
            "type": "nodes",
            "reason": "el flowchart no tiene un nodo 'terminator' de fin (sin aristas salientes y con al menos una entrante)",
        })

    orphans = find_orphan_nodes(nodes, edges)
    orphan_ids = {n.id for n in orphans}
    if orphans:
        ids = ", ".join(sorted(orphan_ids))
        gaps.append({
            "type": "edges",
            "reason": f"nodos sin ninguna conexión (huérfanos): {ids}; faltan aristas de flujo que los enlacen",
        })

    # (E) Conectividad. Semilla: los inicios; si no hay, el primer nodo no-huérfano.
    seeds = [n.id for n in starts]
    if not seeds:
        seeds = [n.id for n in nodes if n.id not in orphan_ids][:1]
    if seeds:
        unreachable = [n for n in find_unreachable_nodes(nodes, edges, seeds) if n.id not in orphan_ids]
        if unreachable:
            ids = ", ".join(sorted(n.id for n in unreachable))
            gaps.append({
                "type": "edges",
                "reason": f"nodos en un grupo aislado del resto del flujo: {ids}; faltan aristas que lo conecten con el inicio",
            })

    return gaps


# Registro DiagramType → validador. Parcial: lo no listado no se valida (permisivo).
STRUCTURAL_VALIDATORS: dict[
    DiagramType, Callable[[list[DiagramNode], list[DiagramEdge]], list[StructuralGap]]
] = {
    DiagramType.FLOWCHART: _validate_flowchart,
}


def validate_structure(
    diagram_type: DiagramType,
    nodes: list[DiagramNode],
    edges: list[DiagramEdge],
) -> list[StructuralGap]:
    """Aplica las reglas estructurales de `diagram_type` al diagrama ensamblado.

    Fallback permisivo: un tipo sin validador registrado devuelve [] (no se
    valida estructuralmente), coherente con node_type_allowed/edge_type_allowed."""
    validator = STRUCTURAL_VALIDATORS.get(diagram_type)
    if validator is None:
        return []
    return validator(nodes, edges)
