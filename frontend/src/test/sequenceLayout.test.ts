import { describe, it, expect } from 'vitest'
import type { DiagramSchema } from '../types'
import { sequenceLayout } from '../ui/utils/sequenceLayout'

const diagram: DiagramSchema = {
  title: 'Test Sequence',
  diagram_type: 'sequence',
  nodes: [
    { id: 'u', label: 'User',   node_type: 'actor', attributes: [] },
    { id: 's', label: 'Server', node_type: 'actor', attributes: [] },
    { id: 'd', label: 'DB',     node_type: 'actor', attributes: [] },
  ],
  edges: [
    { id: 'e1', source: 'u', target: 's', label: 'request', edge_type: 'sequence' },
    { id: 'e2', source: 's', target: 'd', label: 'query',   edge_type: 'sequence' },
  ],
}

const COL_W = 200
const ROW_H = 60
const HEADER_H = 80
const PADDING = 40

describe('sequenceLayout', () => {
  it('actors are distributed in X by index', () => {
    const { nodes } = sequenceLayout(diagram)
    const actors = nodes.filter((n) => n.type === 'sequenceActor')
    expect(actors).toHaveLength(3)
    actors.forEach((node, i) => {
      expect(node.position.x).toBe(i * COL_W)
    })
  })

  it('messages are ordered in Y by array position', () => {
    const { edges } = sequenceLayout(diagram)
    expect(edges).toHaveLength(2)
    edges.forEach((edge, k) => {
      const expectedY = HEADER_H + k * ROW_H
      expect((edge.data as { y: number }).y).toBe(expectedY)
    })
  })

  it('lifelines have correct height', () => {
    const { nodes } = sequenceLayout(diagram)
    const lifelines = nodes.filter((n) => n.type === 'lifeline')
    const totalHeight = HEADER_H + diagram.edges.length * ROW_H + PADDING
    expect(lifelines).toHaveLength(3)
    lifelines.forEach((node) => {
      expect((node.data as { height: number }).height).toBe(totalHeight)
    })
  })

  it('at least one ActivationNode per received message', () => {
    const { nodes } = sequenceLayout(diagram)
    const activations = nodes.filter((n) => n.type === 'activation')
    diagram.edges.forEach((edge) => {
      const hasActivation = activations.some((n) => n.id === `activation-${edge.id}`)
      expect(hasActivation).toBe(true)
    })
  })
})
