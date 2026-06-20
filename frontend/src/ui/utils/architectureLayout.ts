import type { Node, Edge } from '@xyflow/react'
import type { DiagramSchema, NodeType } from '../../types'

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
// Separación vertical entre filas de la rejilla de grupos.
const GROUP_ROW_GAP = 60
const UNGROUPED_GAP = 60

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

/**
 * Layout síncrono determinista para diagramas de arquitectura.
 * Produce nodos contenedor (architectureGroup) con sus hijos anidados (parentId/extent).
 * Los nodos sin group: van al nivel raíz. Respeta node.position del usuario y la
 * geometría manual de los contenedores (group_layout).
 *
 * Los GRUPOS se disponen en una REJILLA (cols = ⌈√n⌉) en lugar de en una fila o
 * columna, para que queden ordenados aunque no haya aristas entre ellos. Como las
 * aristas no se rutean aquí (DiagramCanvas las recalcula desde las cajas medidas),
 * basta con posicionar nodos y dimensionar contenedores. Al ser función PURA de
 * `diagram`, reconciliar rfNodes desde su salida refleja cualquier cambio
 * (mover/redimensionar contenedor, mover hijo, undo/redo, navegar a otra versión).
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

  // 2) Rejilla cuasi-cuadrada: cols = ⌈√n⌉. Ancho de columna uniforme (todos los
  //    grupos miden lo mismo de ancho); alto de cada fila = el del grupo más alto de
  //    esa fila, para que ninguno se solape con el de la fila siguiente.
  const n = groupEntries.length
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)))
  const rows = Math.ceil(n / cols)
  const colW = n > 0 ? Math.max(...groupEntries.map((g) => g.groupW)) : 0
  const rowHeights = Array.from({ length: rows }, (_, r) => {
    let maxH = 0
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c
      if (idx < n) maxH = Math.max(maxH, groupEntries[idx].groupH)
    }
    return maxH
  })
  // Y acumulada del inicio de cada fila.
  const rowY: number[] = []
  let accY = 0
  for (let r = 0; r < rows; r++) {
    rowY.push(accY)
    accY += rowHeights[r] + GROUP_ROW_GAP
  }
  // Borde inferior de la rejilla (sin el último gap sobrante).
  const gridBottom = n > 0 ? accY - GROUP_ROW_GAP : 0

  groupEntries.forEach((g, idx) => {
    const col = idx % cols
    const row = Math.floor(idx / cols)

    // Override manual: si el usuario redimensionó/movió el contenedor, su geometría
    // guardada (group_layout) gana a la posición/tamaño de la rejilla.
    const ov = diagram.group_layout?.[g.containerId]
    rfNodes.push({
      id: g.containerId,
      type: 'architectureGroup',
      position: ov
        ? { x: ov.x, y: ov.y }
        : { x: col * (colW + GROUP_COL_GAP), y: rowY[row] },
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

  // Nodos sin grupo: en fila horizontal debajo de la rejilla de grupos.
  const ungroupedY = n > 0 ? gridBottom + UNGROUPED_GAP : 0
  let uX = 0
  for (const nodeId of ungrouped) {
    const node = nodeById.get(nodeId)!
    const pos = node.position ?? { x: uX + ICON_X_OFFSET, y: ungroupedY }

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

    uX += NODE_W + UNGROUPED_GAP
  }

  const rfEdges: Edge[] = diagram.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null,
    // Un único modelo de edge (EditableEdge, type 'default'): elbow ortogonal, y
    // las dependencias (todo lo que no sea 'calls') discontinuas. data.shape solo
    // es default; si el usuario fijó otra forma, su data persistida la respeta.
    data: {
      label: edge.label ?? '',
      shape: 'elbow' as const,
      strokeStyle: (edge.edge_type ?? 'calls') === 'calls' ? ('normal' as const) : ('dashed' as const),
      ...(edge.data ?? {}),
    },
    type: 'default',
  }))

  return { nodes: rfNodes, edges: rfEdges }
}
