import type { Node, Edge } from '@xyflow/react'
import dagre from '@dagrejs/dagre'
import type { DiagramSchema } from '../../types'

// Paleta por rama: tonos lo bastante oscuros para texto blanco legible y
// con buen contraste sobre el fondo crema del lienzo.
const BRANCH_COLORS = [
  '#2563eb', // azul
  '#dc2626', // rojo
  '#16a34a', // verde
  '#d97706', // ámbar
  '#7c3aed', // violeta
  '#0891b2', // cian
  '#db2777', // rosa
]

// Radio por nivel (el nivel 0 es la raíz en el origen)
function radiusForLevel(level: number): number {
  return 180 + (level - 1) * 150
}

// Grosor de rama decreciente por nivel (gruesa junto a la raíz, fina en hojas).
// Antes vivía en MindmapBranchEdge; ahora se hornea en data.strokeWidth para que
// el render unificado (EditableEdge) lo aplique sin un componente propio.
function branchStrokeWidth(level: number): number {
  return Math.max(1.5, 5 - level * 0.9)
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
    data: { label: e.label ?? '', shape: 'curved', ...(e.data ?? {}) },
    type: 'default',
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

  // Adyacencia NO DIRIGIDA. Un mapa mental es un árbol no dirigido; al REFINAR, el
  // LLM puede emitir alguna arista en sentido hijo→padre. Si construyéramos el árbol
  // con el sentido de la arista, ese subárbol se "despegaría" (quedaría suelto). Con
  // adyacencia no dirigida + orientación por BFS desde la raíz, el sentido deja de
  // importar y el árbol siempre queda conexo.
  const adj = new Map<string, string[]>()
  diagram.nodes.forEach((n) => adj.set(n.id, []))
  assocEdges.forEach((e) => {
    if (adj.has(e.source) && adj.has(e.target)) {
      adj.get(e.source)!.push(e.target)
      adj.get(e.target)!.push(e.source)
    }
  })

  // Nº de nodos en la componente conexa de un nodo (adyacencia no dirigida)
  function countReachable(start: string): number {
    const seen = new Set<string>([start])
    const q = [start]
    while (q.length > 0) {
      const cur = q.shift()!
      for (const c of (adj.get(cur) ?? [])) {
        if (!seen.has(c)) { seen.add(c); q.push(c) }
      }
    }
    return seen.size
  }

  // Detectar raíz: nodo topic sin aristas entrantes
  const rootCandidates = diagram.nodes.filter(
    (n) => n.node_type === 'topic' && (inCount.get(n.id) ?? 0) === 0,
  )

  let rootId: string | null = null

  if (rootCandidates.length === 1) {
    rootId = rootCandidates[0].id
  } else if (rootCandidates.length === 0) {
    // Sin candidatos claros: nodo topic con más salientes
    let maxOut = -1
    for (const n of diagram.nodes) {
      if (n.node_type === 'topic') {
        const out = outCount.get(n.id) ?? 0
        if (out > maxOut) { maxOut = out; rootId = n.id }
      }
    }
  } else {
    // Varios candidatos (nodos sueltos añadidos a mano, u orphan del LLM):
    // NO degradar todo a un dagre plano (perdería colores y aristas de rama);
    // elegir como raíz la del MAYOR subárbol y dejar el resto como nodos sueltos
    // (se posicionan aparte más abajo, en el bloque de nonTreeNodes).
    let best = -1
    for (const cand of rootCandidates) {
      const size = countReachable(cand.id)
      if (size > best) { best = size; rootId = cand.id }
    }
  }

  if (!rootId) return buildDagreFallback(diagram)

  // Construir árbol por BFS (ignora aristas que crearían segundo padre o ciclo)
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

  // Nodos sueltos (no alcanzables desde la raíz: otra componente, o un orphan que
  // el refine no llegó a conectar): estilo NEUTRO y colocados en una FILA DEBAJO del
  // árbol, para que no se amontonen sobre el centro radial (origen) pisándolo.
  const NEUTRAL_COLOR = '#9ca3af'
  const nonTreeNodes = diagram.nodes.filter((n) => !visited.has(n.id))
  if (nonTreeNodes.length > 0) {
    const treePositions = [...positions.values()]
    const maxY = treePositions.length ? Math.max(...treePositions.map((p) => p.y)) : 0
    const minX = treePositions.length ? Math.min(...treePositions.map((p) => p.x)) : 0
    const STRAY_GAP = 180
    let cursorX = minX
    nonTreeNodes.forEach((n) => {
      if (n.position) {
        positions.set(n.id, n.position)
      } else {
        positions.set(n.id, { x: cursorX, y: maxY + 220 })
        cursorX += STRAY_GAP
      }
      levels.set(n.id, 1)
      roles.set(n.id, 'leaf')
      branchColors.set(n.id, NEUTRAL_COLOR)
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

  // Un único modelo de edge (EditableEdge, type 'default'). Las ramas del árbol
  // (association) llevan en data su forma curva, color de rama y grosor por nivel
  // —antes propios de MindmapBranchEdge— y sin flecha. El resto de aristas son
  // curvas normales con flecha y tinta.
  const edges: Edge[] = diagram.edges.map((e) => {
    const isBranch = e.edge_type === 'association'
    const branchProps = isBranch
      ? {
          strokeColor: branchColors.get(e.target) ?? BRANCH_COLORS[0],
          strokeWidth: branchStrokeWidth(levels.get(e.target) ?? 1),
          targetArrow: false,
        }
      : {}
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      data: { label: e.label ?? '', shape: 'curved', ...branchProps, ...(e.data ?? {}) },
      type: 'default',
    } as Edge
  })

  return { nodes, edges }
}
