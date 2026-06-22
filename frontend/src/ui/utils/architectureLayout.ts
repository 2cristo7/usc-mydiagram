import type { Node, Edge } from '@xyflow/react'
import dagre from '@dagrejs/dagre'
import type { DiagramSchema, NodeType } from '../../types'
import { edgeTypeStyle } from './edgeDefaults'

// Tamaños y espaciados del layout síncrono de arquitectura.
// ArchIconNode: la hitbox real (medida por React Flow) es solo el icono 64×64;
// el label (tipo + título, ~130px de ancho) va en posición absoluta debajo y NO
// infla esa caja. Para que el layout reserve el footprint COMPLETO (icono + label)
// declaramos una caja NODE_W×NODE_H y luego centramos el icono dentro de ella
// horizontalmente (ICON_X_OFFSET): así el label cabe dentro de la caja reservada
// y ninguna arista lo cruza.
// Caja real que mide React Flow para un archIcon: icono (64) + holgura PAD (4)
// a cada lado, donde se anclan los edges. Debe coincidir con ICON + 2·PAD de
// ArchIconNode.
const ICON_SIZE = 72
const NODE_W = 140
const NODE_H = 120
// Desplazamiento para centrar la caja del nodo dentro de la caja-footprint.
const ICON_X_OFFSET = (NODE_W - ICON_SIZE) / 2
const NODE_ROW_GAP = 40
const GROUP_PADDING = 30
const GROUP_HEADER_H = 36
const GROUP_COL_GAP = 80
// Separación vertical entre filas de la rejilla de grupos (fallback sin aristas).
const GROUP_ROW_GAP = 60
// Espaciado de dagre entre entidades de nivel superior (contenedores de grupo y
// nodos sueltos): ranksep = avance entre capas del flujo; nodesep = separación
// entre entidades de una misma capa. Generoso porque las cajas-grupo son grandes
// y el ruteo de aristas (DiagramCanvas) necesita aire entre ellas.
const ARCH_RANKSEP = 140
const ARCH_NODESEP = 90

const ARCH_NODE_TYPE_MAP: Partial<Record<NodeType, string>> = {
  person: 'archIcon',
  system: 'archIcon',
  container: 'archIcon',
  component: 'archIcon',
  gateway: 'archIcon',
  service: 'archIcon',
  database: 'archIcon',
  queue: 'archIcon',
}

function nodeRfType(nodeType: NodeType): string {
  return ARCH_NODE_TYPE_MAP[nodeType] ?? 'default'
}

/** Elimina los atributos group: de la lista de atributos visible del nodo. */
function filterGroupAttribs(attributes: string[]): string[] {
  return attributes.filter((a) => !/^group\s*:/i.test(a))
}

/** Extrae el nombre de grupo de un atributo "group: Backend" → "Backend". */
function extractGroupName(attr: string): string | null {
  const m = attr.match(/^group\s*:\s*(.+)/i)
  return m ? m[1].trim() : null
}

export interface ParsedGroups {
  groups: Map<string, string[]>
  ungrouped: string[]
}

/**
 * Parsea los atributos group: del diagrama.
 * Tolerante a espacios y mayúsculas ("group:Backend" == "group: backend").
 */
export function parseGroups(diagram: DiagramSchema): ParsedGroups {
  const groups = new Map<string, string[]>()
  const ungrouped: string[] = []

  for (const node of diagram.nodes) {
    const groupAttr = node.attributes.find((a) => /^group\s*:/i.test(a))
    if (groupAttr) {
      const name = extractGroupName(groupAttr)!
      if (!groups.has(name)) groups.set(name, [])
      groups.get(name)!.push(node.id)
    } else {
      ungrouped.push(node.id)
    }
  }

  return { groups, ungrouped }
}

/** Genera un id de contenedor reproducible a partir del nombre del grupo. */
function groupContainerId(groupName: string): string {
  return `group__${groupName.replace(/\s+/g, '_')}`
}

/** Caja-footprint de una entidad de nivel superior (contenedor o nodo suelto). */
interface Entity {
  id: string
  w: number
  h: number
}

/**
 * Reparte entidades de nivel superior en una REJILLA cuasi-cuadrada (cols = ⌈√n⌉),
 * con ancho de columna uniforme y alto de fila = el de la entidad más alta de esa
 * fila (sin solapes). Es el fallback cuando NO hay aristas entre entidades: sin
 * estructura que seguir, una rejilla ordenada es mejor que la columna única que
 * produciría un layout jerárquico con nodos desconectados.
 * Devuelve la esquina superior izquierda del footprint de cada entidad.
 */
function gridPlacement(entities: Entity[]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>()
  const n = entities.length
  if (n === 0) return pos

  const cols = Math.max(1, Math.ceil(Math.sqrt(n)))
  const rows = Math.ceil(n / cols)
  const colW = Math.max(...entities.map((e) => e.w))
  const rowHeights = Array.from({ length: rows }, (_, r) => {
    let maxH = 0
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c
      if (idx < n) maxH = Math.max(maxH, entities[idx].h)
    }
    return maxH
  })
  const rowY: number[] = []
  let accY = 0
  for (let r = 0; r < rows; r++) {
    rowY.push(accY)
    accY += rowHeights[r] + GROUP_ROW_GAP
  }

  entities.forEach((e, idx) => {
    const col = idx % cols
    const row = Math.floor(idx / cols)
    pos.set(e.id, { x: col * (colW + GROUP_COL_GAP), y: rowY[row] })
  })
  return pos
}

/**
 * Coloca las entidades de nivel superior con dagre (layered, izquierda→derecha)
 * siguiendo las aristas inferidas entre ellas, replicando el flujo del antiguo
 * layout ELK pero de forma SÍNCRONA. dagre devuelve el centro de cada caja; lo
 * convertimos a esquina superior izquierda del footprint.
 */
function dagrePlacement(
  entities: Entity[],
  interEdges: Array<[string, string]>,
): Map<string, { x: number; y: number }> {
  const graph = new dagre.graphlib.Graph()
  graph.setGraph({
    rankdir: 'LR',
    nodesep: ARCH_NODESEP,
    ranksep: ARCH_RANKSEP,
    marginx: 40,
    marginy: 40,
  })
  graph.setDefaultEdgeLabel(() => ({}))

  for (const e of entities) graph.setNode(e.id, { width: e.w, height: e.h })
  for (const [s, t] of interEdges) graph.setEdge(s, t)

  dagre.layout(graph)

  const pos = new Map<string, { x: number; y: number }>()
  for (const e of entities) {
    const g = graph.node(e.id)
    pos.set(e.id, { x: g.x - e.w / 2, y: g.y - e.h / 2 })
  }
  return pos
}

/**
 * Layout síncrono determinista para diagramas de arquitectura.
 * Produce nodos contenedor (architectureGroup) con sus hijos anidados (parentId/extent).
 * Los nodos sin group: van al nivel raíz. Respeta node.position del usuario y la
 * geometría manual de los contenedores (group_layout).
 *
 * Las ENTIDADES de nivel superior (contenedores de grupo + nodos sueltos) se disponen
 * con dagre (layered, izquierda→derecha) SIGUIENDO las aristas entre ellas: las
 * aristas grupo→grupo se infieren de las aristas nodo→nodo. Si no hay aristas entre
 * entidades, se cae a una rejilla cuasi-cuadrada (mejor que la columna única que daría
 * dagre con nodos desconectados). Como las aristas no se rutean aquí (DiagramCanvas las
 * recalcula desde las cajas medidas), basta con posicionar nodos y dimensionar
 * contenedores. Al ser función PURA de `diagram`, reconciliar rfNodes desde su salida
 * refleja cualquier cambio (mover/redimensionar contenedor, mover hijo, undo/redo,
 * navegar a otra versión).
 */
export function architectureLayoutSync(diagram: DiagramSchema): { nodes: Node[]; edges: Edge[] } {
  const { groups, ungrouped } = parseGroups(diagram)
  const nodeById = new Map(diagram.nodes.map((n) => [n.id, n]))

  const rfNodes: Node[] = []

  // 1) Dimensiones de cada grupo: ancho fijo, alto según nº de hijos (apilados).
  const groupEntries = [...groups.entries()].map(([groupName, nodeIds]) => {
    const children = nodeIds.map((id) => nodeById.get(id)).filter(Boolean) as typeof diagram.nodes
    const innerH =
      children.length > 0
        ? children.length * (NODE_H + NODE_ROW_GAP) - NODE_ROW_GAP
        : NODE_H
    const groupW = NODE_W + GROUP_PADDING * 2
    const groupH = GROUP_HEADER_H + GROUP_PADDING + innerH + GROUP_PADDING
    return { groupName, containerId: groupContainerId(groupName), children, groupW, groupH }
  })

  // 2) Entidades de nivel superior: un contenedor por grupo + cada nodo suelto, en
  //    ese orden (determina las celdas de la rejilla en el fallback).
  const entities: Entity[] = [
    ...groupEntries.map((g) => ({ id: g.containerId, w: g.groupW, h: g.groupH })),
    ...ungrouped.map((id) => ({ id, w: NODE_W, h: NODE_H })),
  ]

  // 3) Aristas entre entidades: cada arista nodo→nodo se proyecta a su entidad de
  //    nivel superior (contenedor del grupo o el propio nodo suelto). Se descartan
  //    las internas a un grupo (mismo origen y destino) y los pares duplicados.
  const entityOf = new Map<string, string>()
  for (const g of groupEntries) for (const c of g.children) entityOf.set(c.id, g.containerId)
  for (const id of ungrouped) entityOf.set(id, id)

  const interEdges: Array<[string, string]> = []
  const seenPair = new Set<string>()
  for (const edge of diagram.edges) {
    const s = entityOf.get(edge.source)
    const t = entityOf.get(edge.target)
    if (s === undefined || t === undefined || s === t) continue
    const key = `${s} ${t}`
    if (seenPair.has(key)) continue
    seenPair.add(key)
    interEdges.push([s, t])
  }

  // 4) Posición (esquina superior izquierda del footprint) de cada entidad: dagre si
  //    hay aristas que seguir, rejilla si no.
  const entityPos =
    interEdges.length > 0 ? dagrePlacement(entities, interEdges) : gridPlacement(entities)

  groupEntries.forEach((g) => {
    // Override manual: si el usuario redimensionó/movió el contenedor, su geometría
    // guardada (group_layout) gana a la posición/tamaño calculados.
    const ov = diagram.group_layout?.[g.containerId]
    const auto = entityPos.get(g.containerId) ?? { x: 0, y: 0 }
    rfNodes.push({
      id: g.containerId,
      type: 'architectureGroup',
      position: ov ? { x: ov.x, y: ov.y } : auto,
      data: { label: g.groupName },
      style: ov ? { width: ov.width, height: ov.height } : { width: g.groupW, height: g.groupH },
    } as Node)

    let yChild = GROUP_HEADER_H + GROUP_PADDING
    for (const node of g.children) {
      const childPos = node.position
        ? node.position
        : { x: GROUP_PADDING + ICON_X_OFFSET, y: yChild }

      rfNodes.push({
        id: node.id,
        type: nodeRfType(node.node_type),
        position: childPos,
        parentId: g.containerId,
        extent: 'parent',
        data: {
          label: node.label,
          nodeType: node.node_type,
          attributes: filterGroupAttribs(node.attributes),
        },
      } as Node)

      yChild += NODE_H + NODE_ROW_GAP
    }
  })

  // Nodos sin grupo: en la posición que les asignó dagre/rejilla. El footprint mide
  // NODE_W de ancho y el icono va centrado dentro (ICON_X_OFFSET), igual que un hijo.
  for (const nodeId of ungrouped) {
    const node = nodeById.get(nodeId)!
    const auto = entityPos.get(nodeId) ?? { x: 0, y: 0 }
    const pos = node.position ?? { x: auto.x + ICON_X_OFFSET, y: auto.y }

    rfNodes.push({
      id: node.id,
      type: nodeRfType(node.node_type),
      position: pos,
      data: {
        label: node.label,
        nodeType: node.node_type,
        attributes: filterGroupAttribs(node.attributes),
      },
    } as Node)
  }

  const rfEdges: Edge[] = diagram.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null,
    // Un único modelo de edge (EditableEdge, type 'default'): elbow ortogonal. El
    // estilo según la semántica (calls sólida con punta rellena, dependencias
    // discontinuas con punta abierta) lo decide edgeTypeStyle, la misma fuente que
    // usan buildFlowEdges y el menú contextual. data.shape solo es default; si el
    // usuario fijó otra forma, su data persistida la respeta.
    data: {
      label: edge.label ?? '',
      shape: 'elbow' as const,
      ...edgeTypeStyle(edge.edge_type, 'architecture'),
      ...(edge.data ?? {}),
    },
    type: 'default',
  }))

  return { nodes: rfNodes, edges: rfEdges }
}
