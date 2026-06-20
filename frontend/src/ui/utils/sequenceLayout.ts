import type { Node, Edge } from '@xyflow/react'
import type { DiagramSchema, Fragment } from '../../types'

export const COL_W = 240
export const ROW_H = 60
export const HEADER_H = 80
export const PADDING = 40

// Offset in X from the left edge of the actor column to the lifeline center.
// El nodo actor se renderiza con ancho fijo = 2·ACTOR_CX_OFFSET y la caja
// centrada, de modo que su centro coincide SIEMPRE con este offset (y por tanto
// con la lifeline) sea cual sea la longitud de la etiqueta. Exportado para que
// SequenceActorNode fije ese ancho.
export const ACTOR_CX_OFFSET = 80
export const ACTOR_W = ACTOR_CX_OFFSET * 2

// S10.4 — reserva vertical/horizontal de los marcos de fragmento combinado.
const FRAG_HEADER_H = 24   // banda superior del marco (pestaña kind + guarda)
const FRAG_PAD_BOTTOM = 12 // aire bajo el último mensaje de un fragmento
const FRAME_PAD_X = 34     // holgura horizontal del marco más externo
const FRAME_PAD_STEP = 12  // se estrecha por nivel para que el anidado quede DENTRO

type OperandLayout = { guard: string; topOffset: number }

export function sequenceLayout(diagram: DiagramSchema): { nodes: Node[]; edges: Edge[] } {
  const actors = diagram.nodes.filter((n) => n.node_type === 'actor')
  const messages = diagram.edges
  const fragments = diagram.fragments ?? []

  const resultNodes: Node[] = []
  const resultEdges: Edge[] = []

  // ── Índices de fragmentos ────────────────────────────────────────────────
  const fragById = new Map(fragments.map((f) => [f.id, f]))
  const msgRow = new Map<string, number>()
  messages.forEach((e, k) => msgRow.set(e.id, k))

  // Mensajes (edge ids) de un fragmento, incluidos los de sus hijos transitivos.
  const transitiveMsgs = (f: Fragment, seen = new Set<string>()): string[] => {
    if (seen.has(f.id)) return []
    seen.add(f.id)
    const ids: string[] = []
    for (const op of f.operands) {
      ids.push(...op.message_ids)
      for (const cid of op.child_fragment_ids) {
        const child = fragById.get(cid)
        if (child) ids.push(...transitiveMsgs(child, seen))
      }
    }
    return ids
  }

  // Profundidad de anidamiento (0 = más externo) vía mapa hijo→padre.
  const parentOf = new Map<string, string>()
  for (const f of fragments) {
    for (const op of f.operands) {
      for (const cid of op.child_fragment_ids) parentOf.set(cid, f.id)
    }
  }
  const depthOf = (id: string): number => {
    let d = 0
    let cur = parentOf.get(id)
    const guard = new Set<string>([id])
    while (cur && !guard.has(cur)) { d++; guard.add(cur); cur = parentOf.get(cur) }
    return d
  }

  // Span vertical [start,end] de cada fragmento sobre las filas de sus mensajes.
  // Un fragmento sin ninguna fila válida (mensajes inexistentes) no se renderiza.
  type Span = { start: number; end: number }
  const spanOf = new Map<string, Span>()
  for (const f of fragments) {
    const rows = transitiveMsgs(f).map((id) => msgRow.get(id)).filter((r): r is number => r !== undefined)
    if (rows.length) spanOf.set(f.id, { start: Math.min(...rows), end: Math.max(...rows) })
  }
  const drawable = fragments.filter((f) => spanOf.has(f.id))

  // ── Pasada vertical: posición de cada mensaje reservando espacio de marcos ──
  // Recorremos las filas en orden; al abrir un fragmento reservamos su banda de
  // cabecera, al cerrarlo su aire inferior. Sin fragmentos, esto se reduce a la
  // fórmula histórica (HEADER_H + k·ROW_H + ROW_H/2) → 100% compatible.
  const rowYCenter: number[] = []
  const fragTop = new Map<string, number>()
  const fragBottom = new Map<string, number>()
  let y = HEADER_H

  for (let k = 0; k < messages.length; k++) {
    const opening = drawable
      .filter((f) => spanOf.get(f.id)!.start === k)
      .sort((a, b) => depthOf(a.id) - depthOf(b.id)) // externo primero (arriba)
    for (const f of opening) { fragTop.set(f.id, y); y += FRAG_HEADER_H }

    rowYCenter[k] = y + ROW_H / 2
    y += ROW_H

    const closing = drawable
      .filter((f) => spanOf.get(f.id)!.end === k)
      .sort((a, b) => depthOf(b.id) - depthOf(a.id)) // interno primero (cierra antes)
    for (const f of closing) { y += FRAG_PAD_BOTTOM; fragBottom.set(f.id, y) }
  }
  const totalHeight = y + PADDING

  // ── Actores + lifelines ──────────────────────────────────────────────────
  const actorCenterX = new Map<string, number>()
  const hasStoredX = actors.some((a) => a.position !== undefined)
  const orderedActors = hasStoredX
    ? [...actors].sort((a, b) => (a.position?.x ?? 0) - (b.position?.x ?? 0))
    : actors

  orderedActors.forEach((actor, i) => {
    const x = actor.position !== undefined ? actor.position.x : i * COL_W
    const cx = x + ACTOR_CX_OFFSET
    actorCenterX.set(actor.id, cx)

    resultNodes.push({
      id: actor.id,
      type: 'sequenceActor',
      position: { x, y: 0 },
      data: { label: actor.label, nodeType: actor.node_type },
      draggable: true,
      zIndex: 10,
    })

    // Lifeline como HIJO del actor: posición relativa a la caja (centrada en
    // ACTOR_CX_OFFSET) para que al arrastrar el actor en horizontal la línea lo
    // siga en vivo sin recalcular el layout. absX = actorX + (ACTOR_CX_OFFSET-8) = cx-8.
    resultNodes.push({
      id: `lifeline-${actor.id}`,
      type: 'lifeline',
      parentId: actor.id,
      position: { x: ACTOR_CX_OFFSET - 8, y: HEADER_H },
      data: { height: totalHeight },
      draggable: false,
      selectable: false,
      zIndex: 4,
      style: { width: 16, height: totalHeight },
    })
  })

  // ── Mensajes + activaciones ────────────────────────────────────────────────
  messages.forEach((edge, k) => {
    const arrowY = rowYCenter[k]
    const x1 = actorCenterX.get(edge.source) ?? 0
    const x2 = actorCenterX.get(edge.target) ?? 0

    resultEdges.push({
      id: edge.id,
      source: `lifeline-${edge.source}`,
      target: `lifeline-${edge.target}`,
      type: 'sequenceMessage',
      label: edge.label,
      data: { x1, x2, y: arrowY },
    })

    // Activación como HIJO del actor destino: igual que la lifeline, así la barra
    // de activación viaja con el actor al arrastrarlo. Si el destino no es un actor
    // conocido, cae a posición absoluta (sin parentId) para no romper React Flow.
    const hasTarget = actorCenterX.has(edge.target)
    const targetCx = actorCenterX.get(edge.target) ?? 0
    resultNodes.push({
      id: `activation-${edge.id}`,
      type: 'activation',
      ...(hasTarget ? { parentId: edge.target } : {}),
      position: hasTarget
        ? { x: ACTOR_CX_OFFSET - 8, y: arrowY - ROW_H / 2 }
        : { x: targetCx - 8, y: arrowY - ROW_H / 2 },
      data: {},
      draggable: false,
      selectable: false,
      zIndex: 6,
      style: { width: 16, height: ROW_H },
    })
  })

  // ── Marcos de fragmento ─────────────────────────────────────────────────────
  for (const f of drawable) {
    const top = fragTop.get(f.id)
    const bottom = fragBottom.get(f.id)
    if (top === undefined || bottom === undefined) continue

    // Extensión horizontal: todas las lifelines que tocan sus mensajes transitivos.
    const xs: number[] = []
    for (const id of transitiveMsgs(f)) {
      const e = messages.find((m) => m.id === id)
      if (!e) continue
      const sx = actorCenterX.get(e.source)
      const tx = actorCenterX.get(e.target)
      if (sx !== undefined) xs.push(sx)
      if (tx !== undefined) xs.push(tx)
    }
    if (!xs.length) continue
    const depth = depthOf(f.id)
    const padX = Math.max(FRAME_PAD_X - depth * FRAME_PAD_STEP, 10)
    const minCx = Math.min(...xs)
    const maxCx = Math.max(...xs)
    const frameX = minCx - padX
    const frameW = maxCx - minCx + 2 * padX

    // Bandas de operando: top relativo al marco de cada operando (el primero queda
    // bajo la cabecera; los siguientes dibujan un divisor punteado con su guarda).
    const operands: OperandLayout[] = f.operands.map((op, idx) => {
      const ownRows = op.message_ids
        .map((id) => msgRow.get(id))
        .filter((r): r is number => r !== undefined)
        .map((r) => rowYCenter[r] - ROW_H / 2)
      const childTops = op.child_fragment_ids
        .map((cid) => fragTop.get(cid))
        .filter((t): t is number => t !== undefined)
      const candidates = [...ownRows, ...childTops]
      // Primer operando: la banda arranca justo bajo la cabecera del marco.
      const absTop = idx === 0 || !candidates.length ? top + FRAG_HEADER_H : Math.min(...candidates)
      return { guard: op.guard, topOffset: absTop - top }
    })

    // Override manual: si el usuario redimensionó/movió el marco, su geometría
    // guardada (group_layout) gana al cálculo automático.
    const ov = diagram.group_layout?.[`frag-${f.id}`]
    const fx = ov ? ov.x : frameX
    const fy = ov ? ov.y : top
    const fw = ov ? ov.width : frameW
    const fh = ov ? ov.height : bottom - top
    resultNodes.push({
      id: `frag-${f.id}`,
      type: 'sequenceFragment',
      position: { x: fx, y: fy },
      data: { kind: f.kind, operands, width: fw, height: fh },
      draggable: false,
      // Seleccionable para poder redimensionarlo (perímetro clicable + NodeResizer).
      selectable: true,
      zIndex: depth, // bajo lifelines(4)/activaciones(6)/actores(10); anidado sobre su padre
      style: { width: fw, height: fh },
    })
  }

  return { nodes: resultNodes, edges: resultEdges }
}
