import type { Node, Edge } from '@xyflow/react'
import type { DiagramSchema } from '../../types'

export const COL_W = 240
export const ROW_H = 60
export const HEADER_H = 80
export const PADDING = 40

// Offset in X from the left edge of the actor column to the lifeline center
const ACTOR_CX_OFFSET = 80

export function sequenceLayout(diagram: DiagramSchema): { nodes: Node[]; edges: Edge[] } {
  const actors = diagram.nodes.filter((n) => n.node_type === 'actor')
  const messages = diagram.edges

  // Map actorId → absolute center X of its lifeline
  const actorCenterX = new Map<string, number>()
  const resultNodes: Node[] = []
  const resultEdges: Edge[] = []

  const totalHeight = HEADER_H + messages.length * ROW_H + PADDING

  // Si los actores tienen position.x guardada, los ordenamos por esa X para que
  // el orden visual en el canvas respete el reordenamiento del usuario. Si ninguno
  // tiene posición guardada, el orden original del array se preserva.
  const hasStoredX = actors.some((a) => a.position !== undefined)
  const orderedActors = hasStoredX
    ? [...actors].sort((a, b) => (a.position?.x ?? 0) - (b.position?.x ?? 0))
    : actors

  orderedActors.forEach((actor, i) => {
    // Usa la X guardada del usuario; si no existe, posición automática por índice.
    const x = actor.position !== undefined ? actor.position.x : i * COL_W
    const cx = x + ACTOR_CX_OFFSET
    actorCenterX.set(actor.id, cx)

    resultNodes.push({
      id: actor.id,
      type: 'sequenceActor',
      position: { x, y: 0 },
      data: { label: actor.label, nodeType: actor.node_type },
      // Los actores SÍ son arrastrables (solo en X — DiagramCanvas lo limita).
      draggable: true,
    })

    resultNodes.push({
      id: `lifeline-${actor.id}`,
      type: 'lifeline',
      position: { x: cx - 8, y: HEADER_H },
      data: { height: totalHeight },
      draggable: false,
      selectable: false,
      style: { width: 16, height: totalHeight },
    })
  })

  messages.forEach((edge, k) => {
    // Absolute Y of this message arrow in the canvas
    const arrowY = HEADER_H + k * ROW_H + ROW_H / 2

    const x1 = actorCenterX.get(edge.source) ?? 0
    const x2 = actorCenterX.get(edge.target) ?? 0

    // Connect lifeline nodes so React Flow doesn't try to route from actor headers.
    // The edge renders itself using data.x1/x2/y — React Flow source/target are only
    // used internally and won't affect the visual output of our custom edge renderer.
    resultEdges.push({
      id: edge.id,
      source: `lifeline-${edge.source}`,
      target: `lifeline-${edge.target}`,
      type: 'sequenceMessage',
      label: edge.label,
      data: { x1, x2, y: arrowY },
    })

    const targetCx = actorCenterX.get(edge.target) ?? 0
    resultNodes.push({
      id: `activation-${edge.id}`,
      type: 'activation',
      position: { x: targetCx - 8, y: arrowY - ROW_H / 2 },
      data: {},
      draggable: false,
      selectable: false,
      style: { width: 16, height: ROW_H },
    })
  })

  return { nodes: resultNodes, edges: resultEdges }
}
