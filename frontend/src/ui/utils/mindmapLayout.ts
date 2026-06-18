import type { Node, Edge } from '@xyflow/react'
import dagre from '@dagrejs/dagre'
import type { DiagramSchema } from '../../types'
import { radialControlPoints } from './getWaypointPath'

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

// Suelo de radio por nivel (el nivel 0 es la raíz en el origen). El layout puede
// EXPANDIR este radio si el anillo va apretado (ver computeRadii), pero nunca
// reducirlo: así el caso simple mantiene el aspecto radial clásico (180, 330, …).
function radiusFloorForLevel(level: number): number {
  return 180 + (level - 1) * 150
}

// Tamaño estimado del nodo en px a partir de su etiqueta y rol. No hay medición
// real del DOM en el layout, así que aproximamos ancho ≈ nº caracteres · anchoChar
// + padding horizontal. Debe ir holgado por arriba: subestimar el ancho reintroduce
// solapes en etiquetas largas ("Cadena de Transporte de Electrones").
function estimateNodeSize(label: string, role: 'root' | 'branch' | 'leaf'): { w: number; h: number } {
  const charW = role === 'leaf' ? 6.4 : role === 'branch' ? 7.6 : 9
  const padX = role === 'leaf' ? 24 : role === 'branch' ? 34 : 48
  const h = role === 'leaf' ? 28 : role === 'branch' ? 40 : 48
  const minW = role === 'root' ? 120 : 60
  return { w: Math.max(minW, label.length * charW + padX), h }
}

// Medio-extensión del nodo proyectada sobre la TANGENTE del anillo (perpendicular al
// radio) en el ángulo θ. Es lo que "ocupa de ancho de arco" un nodo colocado en θ.
function tangentialHalf(w: number, h: number, theta: number): number {
  return (w / 2) * Math.abs(Math.sin(theta)) + (h / 2) * Math.abs(Math.cos(theta))
}

// Medio-extensión del nodo proyectada sobre el RADIO en el ángulo θ. Gobierna la
// separación mínima entre anillos consecutivos (padre↔hijo).
function radialHalf(w: number, h: number, theta: number): number {
  return (w / 2) * Math.abs(Math.cos(theta)) + (h / 2) * Math.abs(Math.sin(theta))
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

  // Peso angular de cada subárbol = suma del ANCHO estimado de sus hojas. Repartir la
  // cuña por este peso (y no por nº de hojas) da a las ramas con etiquetas anchas el
  // ángulo que necesitan: si no, sus hojas (que apuntan radialmente y tienen el ancho
  // como extensión tangencial) no caben en la cuña y se apilan radialmente → espiga.
  const labelOf = new Map(diagram.nodes.map((n) => [n.id, n.label]))
  const weightCache = new Map<string, number>()
  function subtreeWeight(id: string): number {
    if (weightCache.has(id)) return weightCache.get(id)!
    const kids = children.get(id) ?? []
    const own = estimateNodeSize(labelOf.get(id) ?? '', 'leaf').w
    const result = kids.length === 0 ? own : kids.reduce((s, k) => s + subtreeWeight(k), 0)
    weightCache.set(id, result)
    return result
  }

  // Mapas de datos calculados
  const positions = new Map<string, { x: number; y: number }>()
  const levels = new Map<string, number>()
  const roles = new Map<string, 'root' | 'branch' | 'leaf'>()
  const branchColors = new Map<string, string>()
  const angles = new Map<string, number>()
  // Ángulo de COLOCACIÓN de cada nodo (hacia afuera). Distinto de `angles`, que
  // apunta al padre. Se rellena en assignAngles y lo consume computeRadii.
  const placeAngle = new Map<string, number>()

  // Inicializar raíz
  const rootNode = diagram.nodes.find((n) => n.id === rootId)!
  levels.set(rootId, 0)
  roles.set(rootId, 'root')
  branchColors.set(rootId, '#000000')
  angles.set(rootId, 0)
  placeAngle.set(rootId, 0)

  // Paso 1 — asignación ANGULAR recursiva (sin posiciones todavía). Reparte la cuña
  // de cada padre entre sus hijos proporcionalmente al nº de hojas del subárbol.
  // level = nivel del nodo padre actual; los hijos van a nivel+1.
  function assignAngles(
    parentId: string,
    startAngle: number,
    endAngle: number,
    level: number,
  ): void {
    const kids = children.get(parentId) ?? []
    if (kids.length === 0) return

    const totalWeight = kids.reduce((s, k) => s + subtreeWeight(k), 0)
    // Hueco angular entre subárboles hermanos: reservamos un % de la cuña como aire
    // repartido en los bordes, para que las hojas de la FRONTERA entre dos ramas no
    // nazcan al mismo ángulo (lo que obligaría a separarlas radialmente → espigas).
    const WEDGE_PAD = level === 0 ? 0 : 0.18
    const fullSpread = endAngle - startAngle
    const spread = fullSpread * (1 - WEDGE_PAD)

    let cursor = startAngle + fullSpread * WEDGE_PAD / 2
    kids.forEach((kid, idx) => {
      const kidWeight = subtreeWeight(kid)
      const wedge = (kidWeight / totalWeight) * spread
      const midAngle = cursor + wedge / 2

      const kidKids = children.get(kid) ?? []
      levels.set(kid, level + 1)
      roles.set(kid, kidKids.length > 0 ? 'branch' : 'leaf')
      placeAngle.set(kid, midAngle)

      // Color heredado del ancestro de nivel 1
      if (level === 0) {
        branchColors.set(kid, BRANCH_COLORS[idx % BRANCH_COLORS.length])
      } else {
        branchColors.set(kid, branchColors.get(parentId) ?? BRANCH_COLORS[0])
      }

      // Ángulo apuntando hacia el padre (dirección inversa al ángulo de colocación)
      angles.set(kid, midAngle + Math.PI)

      assignAngles(kid, cursor, cursor + wedge, level + 1)
      cursor += wedge
    })
  }

  assignAngles(rootId, 0, 2 * Math.PI, 0)

  // Paso 2 — RADIO ADAPTATIVO POR HIJO (no por anillo). Cada hoja se aleja SOLO lo
  // justo para no pisar la caja de su padre ni la de los hermanos ya colocados. Así
  // los hijos cortos quedan pegados a su rama y solo los de etiqueta larga se separan
  // un poco más (mismo efecto que un mapa mental hecho a mano: nada de anillos rígidos).
  const RAD_GAP = 30 // px de hueco mínimo respecto a la caja del padre
  const SIB_GAP = 24 // px de hueco mínimo respecto a un hermano ya colocado
  const STEP = 8 // px de avance radial al resolver una colisión
  const sizeOf = (id: string) => {
    const n = diagram.nodes.find((m) => m.id === id)!
    return estimateNodeSize(n.label, roles.get(id) ?? 'leaf')
  }
  const at = (theta: number, R: number) => ({ x: Math.cos(theta) * R, y: Math.sin(theta) * R })
  const boxesOverlap = (
    ax: number, ay: number, aw: number, ah: number,
    bx: number, by: number, bw: number, bh: number, gap: number,
  ) => Math.abs(ax - bx) < (aw + bw) / 2 + gap && Math.abs(ay - by) < (ah + bh) / 2 + gap

  // Lado de salida de `from` hacia `to` (igual que getFloatingAnchor: domina el eje
  // con mayor componente normalizada por el semieje del nodo).
  const sideBetween = (from: { x: number; y: number; w: number; h: number }, to: { x: number; y: number }) => {
    const dx = to.x - from.x, dy = to.y - from.y
    return Math.abs(dx) / (from.w / 2) > Math.abs(dy) / (from.h / 2)
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'bottom' : 'top')
  }

  // ¿El bezier RADIAL del edge a→b cruza la caja [cx,cy,w,h] (expandida por `gap`)?
  // Usa exactamente los mismos puntos de control que el render (radialControlPoints),
  // así lo que detectamos aquí coincide con lo que se dibuja.
  const radialHitsBox = (
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
    cx: number, cy: number, w: number, h: number, gap: number,
  ): boolean => {
    const [c1, c2] = radialControlPoints(a, b, sideBetween(a, b), sideBetween(b, a))
    const xmin = cx - (w / 2 + gap), xmax = cx + (w / 2 + gap)
    const ymin = cy - (h / 2 + gap), ymax = cy + (h / 2 + gap)
    const SAMPLES = 28
    for (let i = 1; i < SAMPLES; i++) {
      const t = i / SAMPLES, u = 1 - t
      const bx = u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x
      const by = u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y
      if (bx >= xmin && bx <= xmax && by >= ymin && by <= ymax) return true
    }
    return false
  }

  const PUSH_CAP = 300 // tope de empuje radial por nodo (px) — evita espigas

  const radiusOf = new Map<string, number>()
  radiusOf.set(rootId, 0)

  // BFS desde la raíz: un padre siempre tiene radio asignado antes que sus hijos.
  const order: string[] = [rootId]
  for (let qi = 0; qi < order.length; qi++) {
    const parent = order[qi]
    const kids = children.get(parent) ?? []
    if (kids.length === 0) continue

    const Rp = radiusOf.get(parent) ?? 0
    const pTheta = placeAngle.get(parent) ?? 0
    const ps = sizeOf(parent)
    const pPos = at(pTheta, Rp)
    // Las ramas (hijos de la raíz) arrancan en el suelo clásico (~180) para no pegarse
    // al centro; los demás hijos solo necesitan un mínimo despegue de su padre.
    const minR = parent === rootId ? Math.max(radiusFloorForLevel(1), Rp + 90) : Rp + 78

    const placed: { theta: number; R: number; w: number; h: number }[] = []
    const sorted = [...kids].sort((a, b) => (placeAngle.get(a) ?? 0) - (placeAngle.get(b) ?? 0))
    for (const kid of sorted) {
      const theta = placeAngle.get(kid) ?? 0
      const ks = sizeOf(kid)
      let R = minR

      // Aleja del padre hasta que las cajas no se crucen
      for (let g = 0; g < 600; g++) {
        const c = at(theta, R)
        if (!boxesOverlap(c.x, c.y, ks.w, ks.h, pPos.x, pPos.y, ps.w, ps.h, RAD_GAP)) break
        R += STEP
      }
      // Aleja de los hermanos ya colocados (su radio puede diferir → poca colisión,
      // pero etiquetas largas casi verticales aún chocan: se empuja hasta separarlas).
      // TOPE anti-espiga: nunca más de PUSH_CAP px sobre el mínimo. Si una cuña es tan
      // estrecha que no caben, preferimos un roce mínimo a una espiga radial enorme
      // (el reparto por peso ya ensancha las ramas de etiqueta ancha para evitarlo).
      const capR = minR + PUSH_CAP
      for (let pass = 0; pass < 600 && R < capR; pass++) {
        const c = at(theta, R)
        let hit = false
        for (const pl of placed) {
          const p = at(pl.theta, pl.R)
          if (boxesOverlap(c.x, c.y, ks.w, ks.h, p.x, p.y, pl.w, pl.h, SIB_GAP)) { hit = true; break }
        }
        if (!hit) break
        R += STEP
      }

      radiusOf.set(kid, R)
      placed.push({ theta, R, w: ks.w, h: ks.h })
      order.push(kid)
    }
  }

  // Paso 2b — RELAJACIÓN GLOBAL de hojas. La colocación por rama es local: dos hojas
  // de ramas VECINAS pueden pisarse en la frontera de sus cuñas. Empujamos hacia afuera
  // solo las HOJAS (no tienen descendientes → moverlas no rompe ninguna alineación)
  // hasta que no solapen ninguna otra caja. Las ramas con hijos no se tocan.
  const treeIds = order.slice(1) // todos menos la raíz, en orden BFS
  const boxOf = (id: string) => {
    const t = placeAngle.get(id) ?? 0
    const p = at(t, radiusOf.get(id) ?? 0)
    const s = sizeOf(id)
    return { x: p.x, y: p.y, w: s.w, h: s.h }
  }
  const posOf = (id: string) => at(placeAngle.get(id) ?? 0, radiusOf.get(id) ?? 0)
  // Aristas del árbol como pares (padre, hijo): contra ellas comprobamos cruces.
  const treeEdges: { a: string; b: string }[] = []
  const parentOf = new Map<string, string>()
  for (const [parent, kids] of children) {
    for (const kid of kids) { treeEdges.push({ a: parent, b: kid }); parentOf.set(kid, parent) }
  }
  const EDGE_GAP = 14 // margen extra alrededor de la hoja frente a un edge ajeno

  for (let round = 0; round < 400; round++) {
    let moved = false
    for (const id of treeIds) {
      if ((children.get(id) ?? []).length > 0) continue // solo hojas
      // Tope anti-espiga también aquí: no empujar una hoja más allá del radio de su
      // padre + PUSH_CAP. Más allá, aceptamos el roce antes que una espiga.
      const capR = (radiusOf.get(parentOf.get(id) ?? rootId) ?? 0) + PUSH_CAP
      if ((radiusOf.get(id) ?? 0) >= capR) continue
      const theta = placeAngle.get(id) ?? 0
      const s = sizeOf(id)
      const c = at(theta, radiusOf.get(id) ?? 0)
      let hit = false
      // (1) solape con cualquier otro nodo
      for (const other of treeIds) {
        if (other === id) continue
        const b = boxOf(other)
        if (boxesOverlap(c.x, c.y, s.w, s.h, b.x, b.y, b.w, b.h, SIB_GAP)) { hit = true; break }
      }
      // (2) algún edge que NO sea el suyo le cruza por encima
      if (!hit) {
        for (const e of treeEdges) {
          if (e.a === id || e.b === id) continue // su propio edge no cuenta
          const pa = posOf(e.a), sa = sizeOf(e.a)
          const pb = posOf(e.b), sb = sizeOf(e.b)
          const a = { x: pa.x, y: pa.y, w: sa.w, h: sa.h }
          const b = { x: pb.x, y: pb.y, w: sb.w, h: sb.h }
          if (radialHitsBox(a, b, c.x, c.y, s.w, s.h, EDGE_GAP)) { hit = true; break }
        }
      }
      if (hit) { radiusOf.set(id, (radiusOf.get(id) ?? 0) + STEP); moved = true }
    }
    if (!moved) break
  }

  // Paso 3 — POSICIONES finales. Respeta la posición del usuario si existe; si no,
  // coloca el nodo en (R·cosθ, R·senθ) con su radio individual.
  positions.set(rootId, rootNode.position ?? { x: 0, y: 0 })
  for (const [id] of levels) {
    if (id === rootId) continue
    const userNode = diagram.nodes.find((n) => n.id === id)
    if (userNode?.position) {
      positions.set(id, userNode.position)
      continue
    }
    const R = radiusOf.get(id) ?? radiusFloorForLevel(levels.get(id) ?? 1)
    const theta = placeAngle.get(id) ?? 0
    positions.set(id, { x: Math.cos(theta) * R, y: Math.sin(theta) * R })
  }

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
  // (association) llevan en data su forma RADIAL (manijas orientadas al lado de salida
  // del nodo → la curva sigue el árbol y no se comba en horizontal pisando vecinos),
  // color de rama y grosor por nivel —antes propios de MindmapBranchEdge— y sin flecha.
  // El resto de aristas son curvas normales con flecha y tinta.
  const edges: Edge[] = diagram.edges.map((e) => {
    const isBranch = e.edge_type === 'association'
    const branchProps = isBranch
      ? {
          shape: 'radial' as const,
          strokeColor: branchColors.get(e.target) ?? BRANCH_COLORS[0],
          strokeWidth: branchStrokeWidth(levels.get(e.target) ?? 1),
          targetArrow: false,
        }
      : { shape: 'curved' as const }
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      data: { label: e.label ?? '', ...branchProps, ...(e.data ?? {}) },
      type: 'default',
    } as Edge
  })

  return { nodes, edges }
}
