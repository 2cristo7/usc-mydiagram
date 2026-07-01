import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { createElement, useLayoutEffect, useRef, type ReactNode, type ReactElement } from 'react'
import { ReactFlowProvider, useStoreApi } from '@xyflow/react'
import { useStore } from '../store'
import { EditableEdge } from '../components/edges/EditableEdge'
import { SequenceMessageEdge } from '../components/edges/SequenceMessageEdge'
import { EdgeMarkers } from '../components/edges/EdgeMarkers'
import type { EdgeVisualData } from '../types'

vi.mock('../lib/api', () => ({
  persistCurrentDiagram: vi.fn(() => Promise.resolve({ ok: true })),
}))

// jsdom no implementa la geometría SVG que EditableEdge usa para situar la etiqueta
// cuando labelT != 0.5 o hay cardinalidad. Polyfill mínimo.
const g = globalThis as unknown as Record<string, { prototype: Record<string, unknown> } | undefined>
for (const name of ['SVGPathElement', 'SVGGeometryElement', 'SVGElement']) {
  const proto = g[name]?.prototype
  if (proto) {
    proto.getTotalLength = function () {
      return 100
    }
    proto.getPointAtLength = function (l: number) {
      return { x: l, y: 0 } as DOMPoint
    }
  }
}

// Montar un React Flow completo en jsdom no inicializa los nodos (sin medición real
// vía ResizeObserver no se calculan extremos y las aristas no se pintan). En su lugar
// renderizamos la arista AISLADA: useInternalNode devuelve undefined y EditableEdge
// cae a sourceX/sourceY (rama por defecto válida). Para que el portal de
// EdgeLabelRenderer encuentre su host, inyectamos manualmente `domNode` en el store
// interno de React Flow apuntando a un contenedor que incluye el div del renderer.
function Host({ children }: { children: ReactNode }) {
  const api = useStoreApi()
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (ref.current) api.setState({ domNode: ref.current } as never)
  }, [api])
  return createElement(
    'div',
    { ref },
    createElement('div', { className: 'react-flow__edgelabel-renderer' }),
    createElement('svg', null, children)
  )
}

function renderEdge(edge: ReactElement) {
  return render(createElement(ReactFlowProvider, null, createElement(Host, null, edge)))
}

const baseEdgeProps = {
  id: 'e1',
  source: '1',
  target: '2',
  sourceX: 0,
  sourceY: 0,
  targetX: 200,
  targetY: 100,
  markerEnd: '',
}

function labelHost(container: HTMLElement) {
  return container.querySelector('.react-flow__edgelabel-renderer') as HTMLElement
}

beforeEach(() => {
  useStore.setState({ editingNodeId: null })
})

describe('EditableEdge', () => {
  it('renderiza sin crash con forma elbow por defecto', () => {
    const { container } = renderEdge(
      createElement(EditableEdge, {
        ...baseEdgeProps,
        data: { label: '', shape: 'elbow' },
        selected: false,
      } as never)
    )
    expect(container.querySelectorAll('svg path').length).toBeGreaterThanOrEqual(2)
  })

  it('renderiza la etiqueta cuando hay label', () => {
    const { container } = renderEdge(
      createElement(EditableEdge, {
        ...baseEdgeProps,
        data: { label: 'usa', shape: 'elbow' },
        selected: false,
      } as never)
    )
    expect(labelHost(container).textContent).toContain('usa')
  })

  it('forma recta (straight) con dashed y flechas en ambos extremos', () => {
    const { container } = renderEdge(
      createElement(EditableEdge, {
        ...baseEdgeProps,
        data: {
          label: '',
          shape: 'straight',
          strokeStyle: 'dashed',
          sourceArrow: true,
          targetArrow: true,
        } as EdgeVisualData,
        selected: false,
      } as never)
    )
    const visible = container.querySelectorAll('svg path')[1] as SVGPathElement
    expect(visible.getAttribute('stroke-dasharray')).toBe('8 4')
    expect(visible.getAttribute('marker-start')).toContain('arrowReverse')
    expect(visible.getAttribute('marker-end')).toContain('arrow')
  })

  it('markers personalizados tienen prioridad y estilo dotted', () => {
    const { container } = renderEdge(
      createElement(EditableEdge, {
        ...baseEdgeProps,
        data: {
          label: '',
          shape: 'straight',
          markerEndId: 'arrowHollow',
          markerStartId: 'arrow',
          strokeStyle: 'dotted',
        } as EdgeVisualData,
        selected: false,
      } as never)
    )
    const visible = container.querySelectorAll('svg path')[1] as SVGPathElement
    expect(visible.getAttribute('marker-end')).toContain('arrowHollow')
    expect(visible.getAttribute('stroke-dasharray')).toBe('2 4')
  })

  it('selected=true pinta la capa de edición (handles de extremos)', () => {
    const { container } = renderEdge(
      createElement(EditableEdge, {
        ...baseEdgeProps,
        data: { label: '', shape: 'elbow' },
        selected: true,
      } as never)
    )
    expect(container.querySelectorAll('.edge-handle').length).toBeGreaterThan(0)
  })

  it('cardinalidad ERD: renderiza las dos píldoras', async () => {
    const { container } = renderEdge(
      createElement(EditableEdge, {
        ...baseEdgeProps,
        data: {
          label: '',
          shape: 'straight',
          sourceCardinality: '1',
          targetCardinality: 'N',
        } as EdgeVisualData,
        selected: false,
      } as never)
    )
    // Las píldoras dependen de cardPos, fijado en un useLayoutEffect que lee la
    // geometría del path y re-renderiza; findByText espera ese segundo pase.
    expect(await screen.findByText('1')).toBeInTheDocument()
    expect(within(labelHost(container)).getByText('N')).toBeInTheDocument()
  })

  it('doble clic sobre la etiqueta arranca la edición inline', () => {
    const { container } = renderEdge(
      createElement(EditableEdge, {
        ...baseEdgeProps,
        data: { label: 'editar', shape: 'curved' },
        selected: false,
      } as never)
    )
    fireEvent.doubleClick(screen.getByText('editar'))
    const input = labelHost(container).querySelector('input') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.value).toBe('editar')
  })

  it('doble clic en la línea de una forma no-elbow edita la etiqueta', () => {
    const { container } = renderEdge(
      createElement(EditableEdge, {
        ...baseEdgeProps,
        data: { label: 'rel', shape: 'curved' },
        selected: false,
      } as never)
    )
    const hit = container.querySelector('svg path') as SVGPathElement
    fireEvent.doubleClick(hit)
    expect(labelHost(container).querySelector('input')).toBeTruthy()
  })
})

describe('SequenceMessageEdge', () => {
  const seqBase = {
    id: 'e1',
    source: '1',
    target: '2',
    sourceX: 0,
    sourceY: 0,
    targetX: 200,
    targetY: 0,
    markerEnd: '',
  }

  it('mensaje normal renderiza con flecha rellena', () => {
    const { container } = renderEdge(
      createElement(SequenceMessageEdge, {
        ...seqBase,
        label: 'request()',
        data: { x1: 0, x2: 200, y: 50 },
        selected: false,
      } as never)
    )
    expect(labelHost(container).textContent).toContain('request()')
    const visible = container.querySelectorAll('svg path')[1] as SVGPathElement
    expect(visible.getAttribute('marker-end')).toContain('arrowFilled')
  })

  it('reply renderiza con línea discontinua y flecha abierta', () => {
    const { container } = renderEdge(
      createElement(SequenceMessageEdge, {
        ...seqBase,
        label: 'ret',
        data: { x1: 0, x2: 200, y: 50, reply: true },
        selected: false,
      } as never)
    )
    const visible = container.querySelectorAll('svg path')[1] as SVGPathElement
    expect(visible.getAttribute('stroke-dasharray')).toBe('6 4')
    expect(visible.getAttribute('marker-end')).toContain('#arrow')
  })

  it('self-message renderiza el bucle (varios segmentos)', () => {
    const { container } = renderEdge(
      createElement(SequenceMessageEdge, {
        ...seqBase,
        source: '1',
        target: '1',
        label: 'recurse',
        data: { x1: 0, x2: 0, y: 50, self: true },
        selected: false,
      } as never)
    )
    expect(labelHost(container).textContent).toContain('recurse')
    const visible = container.querySelectorAll('svg path')[1] as SVGPathElement
    expect((visible.getAttribute('d') ?? '').split('L').length).toBeGreaterThan(2)
  })

  it('doble clic en la etiqueta arranca edición inline', () => {
    const { container } = renderEdge(
      createElement(SequenceMessageEdge, {
        ...seqBase,
        label: 'ping',
        data: { x1: 0, x2: 200, y: 50 },
        selected: true,
      } as never)
    )
    fireEvent.doubleClick(screen.getByText('ping'))
    expect(labelHost(container).querySelector('textarea')).toBeTruthy()
  })
})

describe('EdgeMarkers', () => {
  it('define los markers SVG por id', () => {
    const { container } = render(createElement(EdgeMarkers) as ReactElement)
    const ids = Array.from(container.querySelectorAll('marker')).map((m) => m.id)
    expect(ids).toContain('arrow')
    expect(ids).toContain('arrowReverse')
    expect(ids).toContain('arrowFilled')
    expect(ids).toContain('arrowHollow')
  })
})
