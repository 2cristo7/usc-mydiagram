import type { Node, Edge } from '@xyflow/react'
import type { DiagramSchema, NodeType } from '../../types'

// Tamaños y espaciados del layout provisional síncrono.
// ArchIconNode: la hitbox real (medida por React Flow) es solo el icono 64×64;
// el label (tipo + título, ~130px de ancho) va en posición absoluta debajo y NO
// infla esa caja. Para que el layout reserve el footprint COMPLETO (icono + label)
// declaramos a ELK una caja NODE_W×NODE_H y luego centramos el icono dentro de
// ella horizontalmente (ICON_X_OFFSET): así el label cabe dentro de la caja
// reservada y ninguna arista lo cruza.
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
 * Layout síncrono provisional para diagramas de arquitectura.
 * Produce nodos contenedor (architectureGroup) con sus hijos anidados (parentId/extent).
 * Los nodos sin group: van al nivel raíz. Respeta node.position del usuario.
 */
export function architectureLayoutSync(diagram: DiagramSchema): { nodes: Node[]; edges: Edge[] } {
  const { groups, ungrouped } = parseGroups(diagram)
  const nodeById = new Map(diagram.nodes.map((n) => [n.id, n]))

  const rfNodes: Node[] = []
  let xOffset = 0
  let maxGroupH = 0

  groups.forEach((nodeIds, groupName) => {
    const containerId = groupContainerId(groupName)
    const children = nodeIds.map((id) => nodeById.get(id)).filter(Boolean) as typeof diagram.nodes

    const innerH =
      children.length > 0
        ? children.length * (NODE_H + NODE_ROW_GAP) - NODE_ROW_GAP
        : NODE_H
    const groupW = NODE_W + GROUP_PADDING * 2
    const groupH = GROUP_HEADER_H + GROUP_PADDING + innerH + GROUP_PADDING

    if (groupH > maxGroupH) maxGroupH = groupH

    rfNodes.push({
      id: containerId,
      type: 'architectureGroup',
      position: { x: xOffset, y: 0 },
      data: { label: groupName },
      style: { width: groupW, height: groupH },
    } as Node)

    let yChild = GROUP_HEADER_H + GROUP_PADDING
    for (const node of children) {
      const childPos = node.position
        ? node.position
        : { x: GROUP_PADDING + ICON_X_OFFSET, y: yChild }

      rfNodes.push({
        id: node.id,
        type: nodeRfType(node.node_type),
        position: childPos,
        parentId: containerId,
        extent: 'parent',
        data: {
          label: node.label,
          nodeType: node.node_type,
          attributes: filterGroupAttribs(node.attributes),
        },
      } as Node)

      yChild += NODE_H + NODE_ROW_GAP
    }

    xOffset += groupW + GROUP_COL_GAP
  })

  // Nodos sin grupo: en fila horizontal (debajo de grupos si los hay)
  const ungroupedY = groups.size > 0 ? maxGroupH + UNGROUPED_GAP : 0
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

// Tipos mínimos para la API de ELK (evitamos depender de tipos que puedan variar por versión)
type ElkNodeInput = {
  id: string
  width?: number
  height?: number
  layoutOptions?: Record<string, string>
  children?: ElkNodeInput[]
}

type ElkLabelInput = {
  id: string
  text: string
  width: number
  height: number
}

type ElkEdgeInput = {
  id: string
  sources: string[]
  targets: string[]
  labels?: ElkLabelInput[]
}

// Ancho aproximado de una edge label (fuente ~13px) para que ELK reserve hueco.
// El render real (EditableEdge) centra la caja; aquí solo importa la reserva.
const EDGE_LABEL_CHAR_W = 7.2
const EDGE_LABEL_PAD = 20
const EDGE_LABEL_H = 26
function estimateEdgeLabelSize(text: string): { width: number; height: number } {
  const trimmed = text.trim()
  if (!trimmed) return { width: 0, height: 0 }
  return {
    width: Math.round(trimmed.length * EDGE_LABEL_CHAR_W + EDGE_LABEL_PAD),
    height: EDGE_LABEL_H,
  }
}

type ElkGraphInput = ElkNodeInput & {
  edges?: ElkEdgeInput[]
}

type ElkNodeResult = {
  id: string
  x?: number
  y?: number
  width?: number
  height?: number
  children?: ElkNodeResult[]
}

/**
 * Layout asíncrono con ELK "layered" + hierarchyHandling=INCLUDE_CHILDREN.
 * Devuelve cajas-módulo (nodo contenedor por grupo) con sus hijos posicionados
 * relativos al padre, como exige React Flow. En caso de error, devuelve el
 * layout provisional síncrono.
 */
export async function architectureLayoutElk(
  diagram: DiagramSchema,
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  if (!diagram.nodes.length) return architectureLayoutSync(diagram)

  try {
    // Importación dinámica para no bloquear el bundle principal
    const ELKModule = await import('elkjs/lib/elk.bundled.js')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ELK = (ELKModule as any).default ?? ELKModule
    const elk = new ELK()

    const { groups, ungrouped } = parseGroups(diagram)
    const nodeById = new Map(diagram.nodes.map((n) => [n.id, n]))

    const elkChildren: ElkNodeInput[] = []

    groups.forEach((nodeIds, groupName) => {
      const containerId = groupContainerId(groupName)
      const children = nodeIds.map((id) => nodeById.get(id)).filter(Boolean) as typeof diagram.nodes

      elkChildren.push({
        id: containerId,
        layoutOptions: {
          'elk.padding': `[top=${GROUP_HEADER_H},left=${GROUP_PADDING},bottom=${GROUP_PADDING},right=${GROUP_PADDING}]`,
        },
        children: children.map((node) => ({
          id: node.id,
          width: NODE_W,
          height: NODE_H,
        })),
      })
    })

    for (const nodeId of ungrouped) {
      elkChildren.push({ id: nodeId, width: NODE_W, height: NODE_H })
    }

    const elkGraph: ElkGraphInput = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
        // Espaciado generoso: las edge labels viven entre capas (dir. RIGHT) y
        // necesitan hueco para no chocar con nodos ni con otras labels.
        'elk.layered.spacing.nodeNodeBetweenLayers': '55',
        'elk.spacing.nodeNode': '35',
        // ELK reserva sitio para los labels declarados (labels[] en cada edge).
        'elk.spacing.edgeLabel': '12',
        'elk.layered.spacing.edgeLabelSpacing': '12',
        'elk.spacing.edgeNode': '40',
        'elk.spacing.edgeEdge': '25',
        'elk.edgeLabels.inline': 'false',
        'elk.padding': '[top=20,left=20,bottom=20,right=20]',
      },
      children: elkChildren,
      edges: diagram.edges.map((e) => {
        const labelText = e.label ?? ''
        const { width, height } = estimateEdgeLabelSize(labelText)
        return {
          id: e.id,
          sources: [e.source],
          targets: [e.target],
          ...(width > 0
            ? { labels: [{ id: `${e.id}__label`, text: labelText, width, height }] }
            : {}),
        }
      }),
    }

    const result = (await elk.layout(elkGraph)) as ElkNodeResult

    // Construir mapa de posiciones absolutas desde el árbol ELK
    const posMap = new Map<string, { x: number; y: number; width?: number; height?: number }>()

    function extractPos(node: ElkNodeResult, parentX = 0, parentY = 0) {
      const absX = (node.x ?? 0) + parentX
      const absY = (node.y ?? 0) + parentY
      posMap.set(node.id, { x: absX, y: absY, width: node.width, height: node.height })
      if (node.children) {
        for (const child of node.children) {
          extractPos(child, absX, absY)
        }
      }
    }
    for (const child of result.children ?? []) {
      extractPos(child)
    }

    const rfNodes: Node[] = []

    groups.forEach((nodeIds, groupName) => {
      const containerId = groupContainerId(groupName)
      const containerPos = posMap.get(containerId)
      const elkContainer = (result.children ?? []).find((c) => c.id === containerId) as
        | ElkNodeResult
        | undefined

      rfNodes.push({
        id: containerId,
        type: 'architectureGroup',
        position: { x: containerPos?.x ?? 0, y: containerPos?.y ?? 0 },
        data: { label: groupName },
        style: {
          width: elkContainer?.width ?? NODE_W + GROUP_PADDING * 2,
          height: elkContainer?.height ?? NODE_H + GROUP_HEADER_H + GROUP_PADDING * 2,
        },
      } as Node)

      const children = nodeIds.map((id) => nodeById.get(id)).filter(Boolean) as typeof diagram.nodes
      for (const node of children) {
        const elkChild = elkContainer?.children?.find((c) => c.id === node.id)
        // Posición del hijo relativa al contenedor
        const relPos = node.position ?? {
          x: (elkChild?.x ?? GROUP_PADDING) + ICON_X_OFFSET,
          y: elkChild?.y ?? GROUP_HEADER_H + GROUP_PADDING,
        }

        rfNodes.push({
          id: node.id,
          type: nodeRfType(node.node_type),
          position: relPos,
          parentId: containerId,
          extent: 'parent',
          data: {
            label: node.label,
            nodeType: node.node_type,
            attributes: filterGroupAttribs(node.attributes),
          },
        } as Node)
      }
    })

    for (const nodeId of ungrouped) {
      const node = nodeById.get(nodeId)!
      const elkPos = posMap.get(nodeId)
      const pos = node.position ?? { x: (elkPos?.x ?? 0) + ICON_X_OFFSET, y: elkPos?.y ?? 0 }

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
      data: { label: edge.label ?? '', ...(edge.data ?? {}), edge_type: edge.edge_type },
      type: 'architecture',
    }))

    return { nodes: rfNodes, edges: rfEdges }
  } catch (err) {
    console.warn('[architectureLayoutElk] ELK error, usando layout síncrono:', err)
    return architectureLayoutSync(diagram)
  }
}
