import { describe, it, expect } from 'vitest'
import type { DiagramSchema } from '../types'
import { sequenceLayout, COL_W, ROW_H, HEADER_H, PADDING } from '../ui/utils/sequenceLayout'

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

// Offset used by sequenceLayout to place lifeline center relative to column X
const ACTOR_CX_OFFSET = 80

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
      const expectedY = HEADER_H + k * ROW_H + ROW_H / 2
      expect((edge.data as { y: number }).y).toBe(expectedY)
    })
  })

  it('message arrows are horizontal — x1 and x2 differ, y is the same for both ends', () => {
    const { edges } = sequenceLayout(diagram)
    edges.forEach((edge) => {
      const d = edge.data as { x1: number; x2: number; y: number }
      // Each message must carry all three coords
      expect(typeof d.x1).toBe('number')
      expect(typeof d.x2).toBe('number')
      expect(typeof d.y).toBe('number')
      // Source and target are different actors → x1 ≠ x2
      expect(d.x1).not.toBe(d.x2)
      // A horizontal arrow has the same Y at both ends (guaranteed by our layout)
      // We verify consistency: data.y is the single shared Y coordinate
      // (the renderer draws M x1 y L x2 y)
      expect(d.y).toBeGreaterThan(HEADER_H)
    })
  })

  it('edge x1/x2 match the center X of source/target actors', () => {
    const { edges } = sequenceLayout(diagram)
    // Actor column centers: u→0*COL_W+OFFSET, s→1*COL_W+OFFSET, d→2*COL_W+OFFSET
    const centerX: Record<string, number> = {
      u: 0 * COL_W + ACTOR_CX_OFFSET,
      s: 1 * COL_W + ACTOR_CX_OFFSET,
      d: 2 * COL_W + ACTOR_CX_OFFSET,
    }
    const e1 = edges.find((e) => e.id === 'e1')!
    const d1 = e1.data as { x1: number; x2: number }
    expect(d1.x1).toBe(centerX['u'])
    expect(d1.x2).toBe(centerX['s'])

    const e2 = edges.find((e) => e.id === 'e2')!
    const d2 = e2.data as { x1: number; x2: number }
    expect(d2.x1).toBe(centerX['s'])
    expect(d2.x2).toBe(centerX['d'])
  })

  it('edge label is present on every message', () => {
    const { edges } = sequenceLayout(diagram)
    edges.forEach((edge) => {
      expect(edge.label).toBeTruthy()
    })
  })

  it('edge source and target connect lifeline nodes (not actor nodes)', () => {
    const { edges } = sequenceLayout(diagram)
    edges.forEach((edge) => {
      expect(edge.source).toMatch(/^lifeline-/)
      expect(edge.target).toMatch(/^lifeline-/)
    })
  })

  it('actor con position.x guardada usa esa X en vez de la automática por índice', () => {
    const savedX = 500
    const diagramWithSavedX: DiagramSchema = {
      ...diagram,
      nodes: [
        { id: 'u', label: 'User',   node_type: 'actor', attributes: [], position: { x: savedX, y: 0 } },
        { id: 's', label: 'Server', node_type: 'actor', attributes: [] },
        { id: 'd', label: 'DB',     node_type: 'actor', attributes: [] },
      ],
    }
    const { nodes } = sequenceLayout(diagramWithSavedX)
    const actorU = nodes.find((n) => n.id === 'u')!
    expect(actorU.position.x).toBe(savedX)
    // Y del actor de secuencia siempre es 0 (cabecera fija)
    expect(actorU.position.y).toBe(0)
  })

  it('actores con position.x guardada se ordenan por esa X (reordenamiento del usuario)', () => {
    // Actor 'd' tiene X menor → aparece primero visualmente aunque esté al final del array
    const diagramReordered: DiagramSchema = {
      ...diagram,
      nodes: [
        { id: 'u', label: 'User',   node_type: 'actor', attributes: [], position: { x: 480, y: 0 } },
        { id: 's', label: 'Server', node_type: 'actor', attributes: [], position: { x: 240, y: 0 } },
        { id: 'd', label: 'DB',     node_type: 'actor', attributes: [], position: { x: 0,   y: 0 } },
      ],
    }
    const { nodes } = sequenceLayout(diagramReordered)
    const actorNodes = nodes.filter((n) => n.type === 'sequenceActor')
    // Ordenados de menor a mayor X
    expect(actorNodes.map((n) => n.id)).toEqual(['d', 's', 'u'])
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

  it('at least one ActivationNode per received message, aligned to Y', () => {
    const { nodes, edges } = sequenceLayout(diagram)
    const activations = nodes.filter((n) => n.type === 'activation')
    diagram.edges.forEach((schemaEdge) => {
      const activation = activations.find((n) => n.id === `activation-${schemaEdge.id}`)
      expect(activation).toBeDefined()
      // The activation Y should match the arrow Y minus half ROW_H
      const flowEdge = edges.find((e) => e.id === schemaEdge.id)!
      const arrowY = (flowEdge.data as { y: number }).y
      expect(activation!.position.y).toBe(arrowY - ROW_H / 2)
    })
  })
})
