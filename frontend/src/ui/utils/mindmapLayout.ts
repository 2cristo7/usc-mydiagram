import type { Node, Edge } from '@xyflow/react'
import dagre from '@dagrejs/dagre'
import type { DiagramSchema } from '../../types'

const BRANCH_COLORS = [
  '#3b82f6', // azul
  '#ef4444', // rojo
  '#22c55e', // verde
  '#f97316', // naranja
  '#a855f7', // violeta
  '#eab308', // amarillo
  '#ec4899', // rosa
]

// Radio por nivel (el nivel 0 es la raíz en el origen)
function radiusForLevel(level: number): number {
  return 180 + (level - 1) * 150
}

function buildDagreFallback(diagram: DiagramSchema): { nodes: Node[]; edges: Edge[] } {
  const graph = new dagre.graphlib.Graph()
  graph.setGraph({ rankdir: 'TB' })
  graph.setDefaultEdgeLabel(() => ({}))

  diagram.nodes.forEach((n) => graph.setNode(n.id, { label: n.label, width: 150, height: 50 }))
  diagram.edges.forEach((e) => graph.setEdge(e.source, e.target, { label: e.label }))
  dagre.layout(graph)

  const nodes: Node[] = diagram.nodes.map((n) => {
    const { x, y } = n.position ?? graph.node(n.id)
    return {
      id: n.id,
      position: { x, y },
      data: { label: n.label, nodeType: n.node_type, attributes: n.attributes },
      type: 'mindmap',
    } as Node
  })

  const edges: Edge[] = diagram.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    data: { label: e.label ?? '' },
  } as Edge))

  return { nodes, edges }
}

export function mindmapLayout(diagram: DiagramSchema): { nodes: Node[]; edges: Edge[] } {
  const assocEdges = diagram.edges.filter((e) => e.edge_type === 'association')

  // Contar aristas entrantes y salientes
  const inCount = new Map<string, number>()
  const outCount = new Map<string, number>()
  diagram.nodes.forEach((n) => { inCount.set(n.id, 0); outCount.set(n.id, 0) })
  assocEdges.forEach((e) => {
    inCount.set(e.target, (inCount.get(e.target) ?? 0) + 1)
    outCount.set(e.source, (outCount.get(e.source) ?? 0) + 1)
  })

  // Detectar raíz: nodo topic sin aristas entrantes
  const rootCandidates = diagram.nodes.filter(
    (n) => n.node_type === 'topic' && (inCount.get(n.id) ?? 0) === 0,
  )

  let rootId: string | null = null

  if (rootCandidates.length === 1) {
    rootId = rootCandidates[0].id
  } else if (rootCandidates.length === 0) {
    // Fallback: nodo con más salientes
    let maxOut = -1
    for (const n of diagram.nodes) {
      if (n.node_type === 'topic') {
        const out = outCount.get(n.id) ?? 0
        if (out > maxOut) { maxOut = out; rootId = n.id }
      }
    }
  } else {
    // Múltiples componentes inconexas → dagre
    return buildDagreFallback(diagram)
  }

  if (!rootId) return buildDagreFallback(diagram)

  // Construir árbol por BFS (ignora aristas que crearían segundo padre o ciclo)
  const adj = new Map<string, string[]>()
  diagram.nodes.forEach((n) => adj.set(n.id, []))
  assocEdges.forEach((e) => {
    if (adj.has(e.source)) adj.get(e.source)!.push(e.target)
  })

  const children = new Map<string, string[]>()
  const visited = new Set<string>()
  const queue: string[] = [rootId]
  visited.add(rootId)
  children.set(rootId, [])

  while (queue.length > 0) {
    const cur = queue.shift()!
    for (const child of (adj.get(cur) ?? [])) {
      if (!visited.has(child)) {
        visited.add(child)
        children.get(cur)!.push(child)
        children.set(child, [])
        queue.push(child)
      }
    }
  }

  // Si el árbol tiene solo la raíz y hay más nodos topic → dagre
  const topicNodes = diagram.nodes.filter((n) => n.node_type === 'topic')
  if (visited.size <= 1 && topicNodes.length > 1) {
    return buildDagreFallback(diagram)
  }

  // Contar hojas de cada subárbol (memoizado)
  const leavesCache = new Map<string, number>()
  function countLeaves(id: string): number {
    if (leavesCache.has(id)) return leavesCache.get(id)!
    const kids = children.get(id) ?? []
    const result = kids.length === 0 ? 1 : kids.reduce((s, k) => s + countLeaves(k), 0)
    leavesCache.set(id, result)
    return result
  }

  // Mapas de datos calculados
  const positions = new Map<string, { x: number; y: number }>()
  const levels = new Map<string, number>()
  const roles = new Map<string, 'root' | 'branch' | 'leaf'>()
  const branchColors = new Map<string, string>()
  const angles = new Map<string, number>()

  // Inicializar raíz
  const rootNode = diagram.nodes.find((n) => n.id === rootId)!
  positions.set(rootId, rootNode.position ?? { x: 0, y: 0 })
  levels.set(rootId, 0)
  roles.set(rootId, 'root')
  branchColors.set(rootId, '#000000')
  angles.set(rootId, 0)

  // Asignación radial recursiva
  // level = nivel del nodo padre actual; los hijos van a nivel+1
  function assignPositions(
    parentId: string,
    startAngle: number,
    endAngle: number,
    level: number,
  ): void {
    const kids = children.get(parentId) ?? []
    if (kids.length === 0) return

    const totalLeaves = kids.reduce((s, k) => s + countLeaves(k), 0)
    const R = radiusForLevel(level + 1)
    const spread = endAngle - startAngle

    let cursor = startAngle
    kids.forEach((kid, idx) => {
      const kidLeaves = countLeaves(kid)
      const wedge = (kidLeaves / totalLeaves) * spread
      const midAngle = cursor + wedge / 2

      // Respetar posición del usuario si existe
      const kidNode = diagram.nodes.find((n) => n.id === kid)
      if (kidNode?.position) {
        positions.set(kid, kidNode.position)
      } else {
        positions.set(kid, {
          x: Math.cos(midAngle) * R,
          y: Math.sin(midAngle) * R,
        })
      }

      const kidKids = children.get(kid) ?? []
      levels.set(kid, level + 1)
      roles.set(kid, kidKids.length > 0 ? 'branch' : 'leaf')

      // Color heredado del ancestro de nivel 1
      if (level === 0) {
        branchColors.set(kid, BRANCH_COLORS[idx % BRANCH_COLORS.length])
      } else {
        branchColors.set(kid, branchColors.get(parentId) ?? BRANCH_COLORS[0])
      }

      // Ángulo apuntando hacia el padre (dirección inversa al ángulo de colocación)
      angles.set(kid, midAngle + Math.PI)

      assignPositions(kid, cursor, cursor + wedge, level + 1)
      cursor += wedge
    })
  }

  assignPositions(rootId, 0, 2 * Math.PI, 0)

  // Nodos que no son topic (no pertenecen al árbol): posición dagre
  const nonTreeNodes = diagram.nodes.filter((n) => !visited.has(n.id))
  if (nonTreeNodes.length > 0) {
    const fallbackGraph = new dagre.graphlib.Graph()
    fallbackGraph.setGraph({ rankdir: 'TB' })
    fallbackGraph.setDefaultEdgeLabel(() => ({}))
    nonTreeNodes.forEach((n) => fallbackGraph.setNode(n.id, { label: n.label, width: 150, height: 50 }))
    dagre.layout(fallbackGraph)
    nonTreeNodes.forEach((n) => {
      if (!n.position) {
        const { x, y } = fallbackGraph.node(n.id)
        positions.set(n.id, { x, y })
      } else {
        positions.set(n.id, n.position)
      }
    })
  }

  const nodes: Node[] = diagram.nodes.map((n) => {
    const pos = positions.get(n.id) ?? { x: 0, y: 0 }
    const level = levels.get(n.id) ?? 0
    const role = roles.get(n.id) ?? 'leaf'
    const branchColor = branchColors.get(n.id) ?? BRANCH_COLORS[0]
    const angle = angles.get(n.id) ?? 0
    return {
      id: n.id,
      position: pos,
      data: {
        label: n.label,
        nodeType: n.node_type,
        attributes: n.attributes,
        level,
        role,
        branchColor,
        angle,
      },
      type: 'mindmap',
    } as Node
  })

  const edges: Edge[] = diagram.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    data: { label: e.label ?? '' },
    type: e.edge_type === 'association' ? 'mindmapBranch' : undefined,
  } as Edge))

  return { nodes, edges }
}
