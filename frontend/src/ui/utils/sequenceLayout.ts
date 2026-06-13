import type { Node, Edge } from '@xyflow/react'
import type { DiagramSchema } from '../../types'

const COL_W = 200
const ROW_H = 60
const HEADER_H = 80
const PADDING = 40

export function sequenceLayout(diagram: DiagramSchema): { nodes: Node[]; edges: Edge[] } {
  const actors = diagram.nodes.filter((n) => n.node_type === 'actor')
  const messages = diagram.edges

  const actorCenterX = new Map<string, number>()
  const resultNodes: Node[] = []
  const resultEdges: Edge[] = []

  const totalHeight = HEADER_H + messages.length * ROW_H + PADDING

  actors.forEach((actor, i) => {
    const x = i * COL_W
    const cx = x + 80
    actorCenterX.set(actor.id, cx)

    resultNodes.push({
      id: actor.id,
      type: 'sequenceActor',
      position: { x, y: 0 },
      data: { label: actor.label, nodeType: actor.node_type },
      draggable: false,
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
    const y = HEADER_H + k * ROW_H

    resultEdges.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'sequenceMessage',
      label: edge.label,
      data: { y },
    })

    const hasTarget = actors.some((a) => a.id === edge.target)
    if (hasTarget) {
      const cx = actorCenterX.get(edge.target) ?? 0
      resultNodes.push({
        id: `activation-${edge.id}`,
        type: 'activation',
        position: { x: cx - 8, y },
        data: {},
        draggable: false,
        selectable: false,
        style: { width: 16, height: ROW_H },
      })
    }
  })

  return { nodes: resultNodes, edges: resultEdges }
}
