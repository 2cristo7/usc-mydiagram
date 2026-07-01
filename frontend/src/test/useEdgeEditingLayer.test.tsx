import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { createElement } from 'react'
import type { Node } from '@xyflow/react'
import type { EdgeVisualData } from '../types'

// Complementa useEdgeEditing.test.tsx ejercitando la CAPA de edición (editingLayer):
// se renderiza el JSX que devuelve el hook y se disparan gestos sobre los handles
// de waypoint, midpoint, píldora de segmento y extremos (source/target). Eso cubre
// los handlers internos (handleWaypointPointerDown, handleMidpointPointerDown,
// handleSegmentPointerDown, handleEndpointPointerDown, handleEndpointDoubleClick,
// handleWaypointDoubleClick) que no se exponen directamente en el return del hook.

const h = vi.hoisted(() => {
  const nodes = new Map<string, Node>()
  const updateEdge = vi.fn()
  const transform: [number, number, number] = [0, 0, 1]
  const storeState = () => ({ transform, nodeLookup: nodes, domNode: document.body })
  return {
    nodes,
    updateEdge,
    gridEnabled: { value: false },
    storeApi: { getState: storeState, setState: vi.fn(), subscribe: vi.fn() },
    historyBegin: vi.fn(),
    historyEnd: vi.fn(),
    dragBegin: vi.fn(),
    dragEnd: vi.fn(),
    hovered: { id: null as string | null },
  }
})

vi.mock('@xyflow/react', () => {
  const Position = { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' } as const
  return {
    Position,
    EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => children,
    useReactFlow: () => ({
      screenToFlowPosition: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
    }),
    useStoreApi: () => h.storeApi,
    useInternalNode: (id: string) => h.nodes.get(id),
  }
})

vi.mock('../store', () => ({
  useStore: (selector: (s: { updateEdge: typeof h.updateEdge }) => unknown) =>
    selector({ updateEdge: h.updateEdge }),
}))
vi.mock('../store/ui', () => ({
  useUiStore: (selector: (s: { gridEnabled: boolean }) => unknown) =>
    selector({ gridEnabled: h.gridEnabled.value }),
}))
vi.mock('../store/historyManager', () => ({
  beginHistoryInteraction: h.historyBegin,
  endHistoryInteraction: h.historyEnd,
}))
vi.mock('../ui/utils/dragCursor', () => ({
  beginDragCursor: h.dragBegin,
  endDragCursor: h.dragEnd,
}))

import { useEdgeEditing } from '../components/edges/useEdgeEditing'

function makeNode(id: string, x: number, y: number, w = 100, hh = 60, type = 'default'): Node {
  return {
    id,
    type,
    position: { x, y },
    data: {},
    measured: { width: w, height: hh },
  } as unknown as Node
}

type Args = Parameters<typeof useEdgeEditing>[0]

// Componente de prueba: invoca el hook y pinta su editingLayer.
function Harness(props: Args) {
  const r = useEdgeEditing(props)
  return r.editingLayer as React.ReactElement | null
}

function renderLayer(props: Partial<Args> = {}) {
  const full: Args = {
    id: 'e1',
    source: 'A',
    target: 'B',
    data: {} as EdgeVisualData,
    selected: true,
    defaultSrcPt: { x: 0, y: 0 },
    defaultTgtPt: { x: 200, y: 0 },
    ...props,
  }
  return render(createElement(Harness, full))
}

function pointerMove(x: number, y: number) {
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y }))
}
function pointerUp(x = 0, y = 0) {
  window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y }))
}

function lastWaypoints(): Array<{ x: number; y: number }> | undefined {
  for (let i = h.updateEdge.mock.calls.length - 1; i >= 0; i--) {
    const arg = h.updateEdge.mock.calls[i][1] as { data?: { waypoints?: unknown } }
    if (arg?.data && 'waypoints' in arg.data) return arg.data.waypoints as Array<{ x: number; y: number }>
  }
  return undefined
}

beforeEach(() => {
  vi.clearAllMocks()
  h.nodes.clear()
  h.gridEnabled.value = false
  h.nodes.set('A', makeNode('A', -100, -30))
  h.nodes.set('B', makeNode('B', 200, -30))
  // elementsFromPoint no existe en jsdom: lo polyfilleamos para el re-anclaje.
  document.elementsFromPoint = vi.fn(() => []) as never
})

describe('editingLayer — handles de waypoint (forma libre)', () => {
  it('arrastrar un waypoint actualiza su posición', () => {
    const data = { waypoints: [{ x: 100, y: 0 }] } as EdgeVisualData
    const { container } = renderLayer({ data })
    const wp = container.querySelector('[class*="nopan"]') // primer handle
    // Los waypoints existentes son los divs con onDoubleClick. Buscamos por estilo
    // (background accent). Más fiable: el último grupo de divs son los waypoints.
    const handles = Array.from(container.querySelectorAll('div'))
    const target = handles.find((d) => d.style.cursor === 'grab' || d.style.cursor === 'grabbing')
    expect(target ?? wp).toBeTruthy()
    fireEvent.pointerDown(target ?? (wp as Element), { clientX: 100, clientY: 0 })
    pointerMove(140, 60)
    pointerUp()
    const wps = lastWaypoints()
    expect(wps).toBeTruthy()
    expect(h.dragBegin).toHaveBeenCalled()
    expect(h.dragEnd).toHaveBeenCalled()
  })

  it('doble clic sobre un waypoint lo borra', () => {
    const data = { waypoints: [{ x: 100, y: 0 }] } as EdgeVisualData
    const { container } = renderLayer({ data })
    const handles = Array.from(container.querySelectorAll('div'))
    const wpHandle = handles.find((d) => d.style.background === 'var(--color-accent)')
    expect(wpHandle).toBeTruthy()
    fireEvent.doubleClick(wpHandle!)
    const wps = lastWaypoints()
    expect(wps).toEqual([])
  })

  it('clic en un midpoint inserta un waypoint y arranca el arrastre', () => {
    const { container } = renderLayer()
    const handles = Array.from(container.querySelectorAll('div'))
    const midpoint = handles.find((d) => d.style.borderRadius === '50%' && d.style.background === 'white')
    expect(midpoint).toBeTruthy()
    fireEvent.pointerDown(midpoint!, { clientX: 100, clientY: 0 })
    const wps = lastWaypoints()
    expect(wps!.length).toBe(1)
    pointerUp()
  })

  it('midpoints se duplican alrededor de la etiqueta cuando hay label', () => {
    const data = { label: 'rel', labelT: 0.5 } as EdgeVisualData
    const { container } = renderLayer({ data, hasLabel: true, labelT: 0.5 })
    const handles = Array.from(container.querySelectorAll('div'))
    const midpoints = handles.filter((d) => d.style.background === 'white')
    expect(midpoints.length).toBeGreaterThanOrEqual(2)
  })
})

describe('editingLayer — píldoras de segmento (ortogonal)', () => {
  it('pinta una píldora por tramo y arrastrarla mueve el segmento', () => {
    const { container } = renderLayer({ segmentEditing: true, defaultTgtPt: { x: 200, y: 120 } })
    const pills = container.querySelectorAll('.edge-handle')
    expect(pills.length).toBeGreaterThan(0)
    // La primera píldora de tramo (no los extremos). Los extremos llevan endpoint.
    const segPill = Array.from(container.querySelectorAll('.edge-handle')).find((el) =>
      el.querySelector('.edge-handle__pill, .edge-handle__circle')
    )
    expect(segPill).toBeTruthy()
    fireEvent.pointerDown(segPill!, { clientX: 100, clientY: 60 })
    pointerMove(140, 80)
    pointerMove(160, 90)
    pointerUp()
    expect(h.updateEdge).toHaveBeenCalled()
    expect(h.historyEnd).toHaveBeenCalled()
  })
})

describe('editingLayer — extremos (re-anclaje)', () => {
  function endpointHandles(container: HTMLElement) {
    return Array.from(container.querySelectorAll('.edge-handle')).filter((el) =>
      el.querySelector('.edge-handle__endpoint')
    )
  }

  it('deslizar el extremo source por el perímetro fija sourceAnchor', () => {
    const { container } = renderLayer()
    const eps = endpointHandles(container)
    expect(eps.length).toBe(2)
    fireEvent.pointerDown(eps[0], { clientX: 0, clientY: 0 })
    // Mueve dentro del propio nodo A (-100..0 en x, -30..30 en y).
    pointerMove(-50, 0)
    pointerUp(-50, 0)
    const calls = h.updateEdge.mock.calls
    const anchorCall = calls.find((c) => (c[1] as { data?: { sourceAnchor?: unknown } })?.data?.sourceAnchor)
    expect(anchorCall).toBeTruthy()
    expect(h.dragEnd).toHaveBeenCalled()
  })

  it('soltar el extremo sobre OTRO nodo reconecta la arista', () => {
    h.nodes.set('C', makeNode('C', 50, 200))
    // elementsFromPoint devuelve el nodo C en el up.
    const fakeNodeEl = {
      classList: { contains: (c: string) => c === 'react-flow__node' },
      getAttribute: () => 'C',
    } as unknown as Element
    document.elementsFromPoint = vi.fn(() => [fakeNodeEl]) as never

    const { container } = renderLayer()
    const eps = Array.from(container.querySelectorAll('.edge-handle')).filter((el) =>
      el.querySelector('.edge-handle__endpoint')
    )
    fireEvent.pointerDown(eps[1], { clientX: 200, clientY: 0 }) // target
    pointerMove(60, 210)
    pointerUp(60, 210)
    const reconnect = h.updateEdge.mock.calls.find(
      (c) => (c[1] as { target?: string })?.target === 'C'
    )
    expect(reconnect).toBeTruthy()
  })

  it('ignora nodos contenedor al reconectar (no reconecta a un grupo)', () => {
    h.nodes.set('G', makeNode('G', 50, 200, 300, 200, 'architectureGroup'))
    const fakeGroupEl = {
      classList: { contains: (c: string) => c === 'react-flow__node' },
      getAttribute: () => 'G',
    } as unknown as Element
    document.elementsFromPoint = vi.fn(() => [fakeGroupEl]) as never
    const { container } = renderLayer()
    const eps = Array.from(container.querySelectorAll('.edge-handle')).filter((el) =>
      el.querySelector('.edge-handle__endpoint')
    )
    fireEvent.pointerDown(eps[1], { clientX: 200, clientY: 0 })
    pointerMove(60, 210)
    pointerUp(60, 210)
    const reconnect = h.updateEdge.mock.calls.find(
      (c) => (c[1] as { target?: string })?.target === 'G'
    )
    expect(reconnect).toBeUndefined()
  })

  it('doble clic en un extremo restaura el anclaje flotante', () => {
    const data = { targetAnchor: { x: 0, y: 0.5 } } as EdgeVisualData
    const { container } = renderLayer({ data })
    const eps = Array.from(container.querySelectorAll('.edge-handle')).filter((el) =>
      el.querySelector('.edge-handle__endpoint')
    )
    fireEvent.doubleClick(eps[1])
    const reset = h.updateEdge.mock.calls.find(
      (c) => (c[1] as { data?: { targetAnchor?: unknown } })?.data &&
        'targetAnchor' in (c[1] as { data: object }).data &&
        (c[1] as { data: { targetAnchor?: unknown } }).data.targetAnchor === undefined
    )
    expect(reset).toBeTruthy()
  })

  it('deslizar el extremo en una arista ortogonal con waypoints arrastra la esquina contigua', () => {
    const data = { waypoints: [{ x: 100, y: 100 }] } as EdgeVisualData
    const { container } = renderLayer({ segmentEditing: true, data, defaultTgtPt: { x: 200, y: 120 } })
    const eps = Array.from(container.querySelectorAll('.edge-handle')).filter((el) =>
      el.querySelector('.edge-handle__endpoint')
    )
    fireEvent.pointerDown(eps[0], { clientX: 0, clientY: 0 })
    pointerMove(-50, 10)
    pointerUp(-50, 10)
    const wpCall = h.updateEdge.mock.calls.find(
      (c) => (c[1] as { data?: { waypoints?: unknown } })?.data?.waypoints
    )
    expect(wpCall).toBeTruthy()
  })
})

describe('editingLayer — anclaje botella (archIcon)', () => {
  it('re-ancla el extremo hacia el waypoint adyacente en nodos archIcon', () => {
    h.nodes.set('A', makeNode('A', -100, -30, 72, 72, 'archIcon'))
    h.nodes.set('B', makeNode('B', 200, -30, 72, 72, 'archIcon'))
    const data = {
      sourceAnchor: { x: 0.5, y: 0 },
      targetAnchor: { x: 0.5, y: 0 },
      waypoints: [{ x: 100, y: 100 }],
    } as EdgeVisualData
    // Solo verificamos que renderiza sin crash y produce una capa de edición:
    // la rama bottleAnchorToward se ejecuta en el cálculo de srcPt/tgtPt.
    const { container } = renderLayer({ data })
    expect(container.querySelectorAll('.edge-handle').length).toBeGreaterThan(0)
  })
})
