import { describe, expect, test } from 'vitest'
import { liveLayout } from '../ui/utils/liveLayout'
import type { DiagramSchema, NodeType } from '../types'

const N = (id: string) => ({ id, label: id, node_type: 'topic' as NodeType, attributes: [] })
const E = (s: string, t: string) => ({ id: `${s}_${t}`, source: s, target: t, label: '', edge_type: 'association' as const })

function bbox(nodes: { position: { x: number; y: number } }[]) {
  const xs = nodes.map((n) => n.position.x)
  const ys = nodes.map((n) => n.position.y)
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}

describe('liveLayout — montaje en vivo', () => {
  // Fase nodos (sin aristas): círculo radial compacto, no una fila ancha.
  test('sin aristas coloca los nodos en un círculo compacto', () => {
    const d = { title: 'm', diagram_type: 'mindmap', nodes: Array.from({ length: 12 }, (_, i) => N('n' + i)), edges: [] } as unknown as DiagramSchema
    const { nodes, edges } = liveLayout(d)
    expect(nodes).toHaveLength(12)
    expect(edges).toHaveLength(0)
    const { w, h } = bbox(nodes)
    // Compacto y aproximadamente cuadrado (círculo), no un layout degenerado ancho.
    expect(w).toBeLessThan(900)
    expect(h).toBeLessThan(900)
    expect(Math.abs(w - h)).toBeLessThan(250)
  })

  test('un solo nodo queda centrado (sin NaN)', () => {
    const d = { title: 'm', diagram_type: 'mindmap', nodes: [N('solo')], edges: [] } as unknown as DiagramSchema
    const { nodes } = liveLayout(d)
    expect(Number.isFinite(nodes[0].position.x)).toBe(true)
    expect(Number.isFinite(nodes[0].position.y)).toBe(true)
  })

  // Fase mixta: parte conectada (estructura real) + nodos sueltos esperando en anillo.
  test('con aristas: los conectados usan la estructura real y los sueltos esperan en un anillo exterior', () => {
    const d = {
      title: 'm', diagram_type: 'mindmap',
      nodes: ['root', 'a', 'b', 'c', 'd', 'e'].map(N),
      edges: [E('root', 'a'), E('root', 'b'), E('root', 'c')],
    } as unknown as DiagramSchema
    const { nodes, edges } = liveLayout(d)
    expect(edges).toHaveLength(3)
    const byId = new Map(nodes.map((n) => [n.id, n.position]))
    // centro de la estructura conectada
    const conn = ['root', 'a', 'b', 'c'].map((id) => byId.get(id)!)
    const cx = conn.reduce((s, p) => s + p.x, 0) / conn.length
    const cy = conn.reduce((s, p) => s + p.y, 0) / conn.length
    const maxConn = Math.max(...conn.map((p) => Math.hypot(p.x - cx, p.y - cy)))
    // los sueltos quedan MÁS LEJOS del centro que cualquier conectado (anillo exterior)
    for (const id of ['d', 'e']) {
      const p = byId.get(id)!
      expect(Math.hypot(p.x - cx, p.y - cy)).toBeGreaterThan(maxConn)
    }
  })
})
