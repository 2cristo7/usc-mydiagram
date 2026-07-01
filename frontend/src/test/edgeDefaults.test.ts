import { describe, it, expect } from 'vitest'
import {
  defaultEdgeShape,
  edgeTypeStyle,
  predictEdgeDefaults,
} from '../ui/utils/edgeDefaults'
import type { DiagramSchema } from '../types'

describe('defaultEdgeShape', () => {
  it('mindmap → curved', () => {
    expect(defaultEdgeShape('mindmap')).toBe('curved')
  })
  it('use_case → straight', () => {
    expect(defaultEdgeShape('use_case')).toBe('straight')
  })
  it('erd, flowchart, architecture y undefined → elbow', () => {
    expect(defaultEdgeShape('erd')).toBe('elbow')
    expect(defaultEdgeShape('flowchart')).toBe('elbow')
    expect(defaultEdgeShape('architecture')).toBe('elbow')
    expect(defaultEdgeShape(undefined)).toBe('elbow')
  })
})

describe('edgeTypeStyle — arquitectura', () => {
  it("'calls' → sólida con punta rellena", () => {
    const s = edgeTypeStyle('calls', 'architecture')
    expect(s.markerEndId).toBe('arrowFilled')
    expect(s.strokeStyle).toBe('normal')
    expect(s.targetArrow).toBe(true)
  })
  it('sin edge_type → se trata como calls (default)', () => {
    const s = edgeTypeStyle(undefined, 'architecture')
    expect(s.markerEndId).toBe('arrowFilled')
  })
  it("relación de dependencia → discontinua sin punta rellena", () => {
    const s = edgeTypeStyle('depends_on', 'architecture')
    expect(s.strokeStyle).toBe('dashed')
    expect(s.markerEndId).toBeUndefined()
  })
})

describe('edgeTypeStyle — ERD (cardinalidades)', () => {
  it('one_to_many → 1 … N, sin flecha', () => {
    const s = edgeTypeStyle('one_to_many', 'erd')
    expect(s.sourceCardinality).toBe('1')
    expect(s.targetCardinality).toBe('N')
    expect(s.targetArrow).toBe(false)
  })
  it('many_to_many → M … N', () => {
    const s = edgeTypeStyle('many_to_many', 'erd')
    expect(s.sourceCardinality).toBe('M')
    expect(s.targetCardinality).toBe('N')
  })
  it('one_to_one → 1 … 1', () => {
    const s = edgeTypeStyle('one_to_one', 'erd')
    expect(s.sourceCardinality).toBe('1')
    expect(s.targetCardinality).toBe('1')
  })
  it('sin tipo en ERD → cae a 1 … 1', () => {
    const s = edgeTypeStyle(undefined, 'erd')
    expect(s.sourceCardinality).toBe('1')
    expect(s.targetCardinality).toBe('1')
  })
})

describe('edgeTypeStyle — UML / casos de uso (switch por edge_type)', () => {
  it('include → discontinua', () => {
    const s = edgeTypeStyle('include', 'use_case')
    expect(s.strokeStyle).toBe('dashed')
    expect(s.targetArrow).toBe(true)
  })
  it('extend → discontinua', () => {
    expect(edgeTypeStyle('extend', 'use_case').strokeStyle).toBe('dashed')
  })
  it('inherits → triángulo hueco, sin flecha simple', () => {
    const s = edgeTypeStyle('inherits', 'use_case')
    expect(s.markerEndId).toBe('arrowHollow')
    expect(s.targetArrow).toBe(false)
  })
  it('association → sólida sin flecha', () => {
    const s = edgeTypeStyle('association', 'use_case')
    expect(s.targetArrow).toBe(false)
    expect(s.strokeStyle).toBe('normal')
  })
  it('edge_type no especial (ej. flow) → estilo base (flecha al destino)', () => {
    const s = edgeTypeStyle('flow', 'flowchart')
    expect(s.targetArrow).toBe(true)
    expect(s.sourceArrow).toBe(false)
    expect(s.strokeStyle).toBe('normal')
    expect(s.markerEndId).toBeUndefined()
  })
})

// Helper para construir un DiagramSchema mínimo con un set de aristas dado.
function makeDiagram(
  diagram_type: DiagramSchema['diagram_type'] | undefined,
  edges: DiagramSchema['edges'],
): DiagramSchema {
  return {
    title: 't',
    diagram_type: diagram_type as DiagramSchema['diagram_type'],
    nodes: [],
    edges,
  } as DiagramSchema
}

describe('predictEdgeDefaults', () => {
  it('diagrama nulo → defaults por ausencia de tipo (elbow, association, normal)', () => {
    const p = predictEdgeDefaults(null)
    expect(p.shape).toBe('elbow')
    expect(p.edge_type).toBe('association')
    expect(p.strokeStyle).toBe('normal')
    expect(p.sourceArrow).toBe(false)
    expect(p.targetArrow).toBe(true)
  })

  it('diagrama vacío de tipo mindmap → cae al default por tipo (curved)', () => {
    const p = predictEdgeDefaults(makeDiagram('mindmap', []))
    expect(p.shape).toBe('curved')
    expect(p.edge_type).toBe('association')
  })

  it('infiere la MODA de la forma de las aristas existentes', () => {
    const d = makeDiagram('erd', [
      { id: 'e1', source: 'a', target: 'b', label: '', data: { shape: 'curved' } },
      { id: 'e2', source: 'b', target: 'c', label: '', data: { shape: 'curved' } },
      { id: 'e3', source: 'c', target: 'd', label: '', data: { shape: 'straight' } },
    ] as DiagramSchema['edges'])
    const p = predictEdgeDefaults(d)
    expect(p.shape).toBe('curved') // 2 vs 1
  })

  it('infiere la moda del edge_type y del strokeStyle', () => {
    const d = makeDiagram('architecture', [
      { id: 'e1', source: 'a', target: 'b', label: '', edge_type: 'calls', data: { strokeStyle: 'dashed' } },
      { id: 'e2', source: 'b', target: 'c', label: '', edge_type: 'calls', data: { strokeStyle: 'dashed' } },
      { id: 'e3', source: 'c', target: 'd', label: '', edge_type: 'depends_on', data: { strokeStyle: 'normal' } },
    ] as DiagramSchema['edges'])
    const p = predictEdgeDefaults(d)
    expect(p.edge_type).toBe('calls')
    expect(p.strokeStyle).toBe('dashed')
  })

  it('aristas sin shape/edge_type/strokeStyle definidos → cae a defaults', () => {
    const d = makeDiagram('flowchart', [
      { id: 'e1', source: 'a', target: 'b', label: '' },
    ] as DiagramSchema['edges'])
    const p = predictEdgeDefaults(d)
    expect(p.shape).toBe('elbow') // default flowchart
    expect(p.edge_type).toBe('association') // no hay tipos → default
    expect(p.strokeStyle).toBe('normal')
  })
})
