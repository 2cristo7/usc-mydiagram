import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { useStore } from '../store'
import type { DiagramType, NodeType, VersionMeta } from '../types'

// Mock de api para no disparar fetch real. persistCurrentDiagram devuelve una
// versión manual_edit que el autosave añade al diario; renameDiagram resuelve ok.
const persistMock = vi.fn(() =>
  Promise.resolve({
    ok: true as const,
    version: {
      id: 'v-auto',
      seq: 99,
      origin: 'manual_edit' as const,
      instruction: null,
      op_summary: null,
      parent_version_id: null,
      created_at: '',
    } as VersionMeta,
  }),
)
const renameMock = vi.fn(() => Promise.resolve({ ok: true }))

vi.mock('../lib/api', () => ({
  persistCurrentDiagram: (...args: unknown[]) => persistMock(...(args as [])),
  renameDiagram: (...args: unknown[]) => renameMock(...(args as [])),
}))

// Reset del store a un estado limpio antes de cada test.
beforeEach(() => {
  persistMock.mockClear()
  renameMock.mockClear()
  useStore.setState({
    versions: [],
    currentVersionSeq: null,
    currentVersionId: null,
    headVersionId: null,
    activeOperation: null,
    uiState: 'idle',
    generationPhase: 'idle',
    nodes: [],
    edges: [],
    currentDiagram: null,
    currentDiagramId: null,
    lastGenerationPrompt: null,
    lastGenerationType: null,
    selectedDiagramType: null,
    streamingType: null,
    streamingTitle: null,
    toolTrace: [],
    pendingClarification: null,
    pendingTypeChoice: null,
    editRequestNodeId: null,
    editingNodeId: null,
    trashedDiagram: null,
    relayoutTick: 0,
    navTick: 0,
    saving: false,
    saveError: null,
    promptDrafts: {},
  })
})

const seed = () => ({
  title: 'Tienda',
  diagram_type: 'erd' as DiagramType,
  nodes: [
    { id: 'a', label: 'A', node_type: 'table' as NodeType, attributes: [], position: { x: 10, y: 20 } },
    { id: 'b', label: 'B', node_type: 'table' as NodeType, attributes: [], position: { x: 30, y: 40 } },
  ],
  edges: [
    { id: 'a__b', source: 'a', target: 'b', label: 'rel', edge_type: 'many_to_many' as const, data: { waypoints: [{ x: 1, y: 1 }] } },
  ],
})

// ── setVersions / goToVersion ──────────────────────────────────────────────

test('setVersions posiciona en la última versión (mayor seq) y fija el ancla', () => {
  const v1: VersionMeta = { id: 'g', seq: 1, origin: 'generate', instruction: 'x', op_summary: null, parent_version_id: null, created_at: '' }
  const v2: VersionMeta = { id: 'r', seq: 2, origin: 'refine', instruction: 'y', op_summary: null, parent_version_id: 'g', created_at: '' }
  useStore.getState().setVersions([v1, v2])
  const s = useStore.getState()
  expect(s.versions).toEqual([v1, v2])
  expect(s.currentVersionSeq).toBe(2)
  expect(s.currentVersionId).toBe('r')
  expect(s.headVersionId).toBe('r')
})

test('setVersions con lista vacía deja todo en null', () => {
  useStore.getState().setVersions([])
  const s = useStore.getState()
  expect(s.currentVersionSeq).toBeNull()
  expect(s.currentVersionId).toBeNull()
  expect(s.headVersionId).toBeNull()
})

test('goToVersion: navega a un snapshot sin crear versión y avanza navTick', () => {
  const before = useStore.getState().navTick
  const version: VersionMeta = { id: 'g', seq: 3, origin: 'generate', instruction: 'x', op_summary: null, parent_version_id: null, created_at: '' }
  const diagram = seed()
  useStore.setState({ trashedDiagram: { id: 'z', title: 'T' } })
  useStore.getState().goToVersion(version, diagram)
  const s = useStore.getState()
  expect(s.currentDiagram).toBe(diagram)
  expect(s.nodes).toBe(diagram.nodes)
  expect(s.edges).toBe(diagram.edges)
  expect(s.currentVersionSeq).toBe(3)
  expect(s.currentVersionId).toBe('g')
  expect(s.trashedDiagram).toBeNull()
  expect(s.navTick).toBe(before + 1)
})

// ── relayout ───────────────────────────────────────────────────────────────

test('relayout descarta posiciones, waypoints y group_layout, e incrementa relayoutTick', () => {
  const diagram = { ...seed(), group_layout: { g1: { x: 0, y: 0, width: 100, height: 100 } } }
  useStore.getState().setCurrentDiagram(diagram)
  useStore.getState().relayout()
  const s = useStore.getState()
  expect(s.nodes.every((n) => n.position === undefined)).toBe(true)
  expect(s.edges[0].data?.waypoints).toBeUndefined()
  expect(s.currentDiagram!.group_layout).toBeUndefined()
  expect(s.relayoutTick).toBe(1)
})

test('relayout es no-op si no hay diagrama vivo', () => {
  useStore.getState().relayout()
  expect(useStore.getState().relayoutTick).toBe(0)
  expect(useStore.getState().currentDiagram).toBeNull()
})

// ── newDiagram / markCurrentTrashed / importDiagram ─────────────────────────

test('newDiagram resetea el workspace a estado en blanco', () => {
  useStore.getState().setCurrentDiagram(seed())
  useStore.setState({ currentDiagramId: 'x', uiState: 'ready', versions: [{ id: 'v', seq: 1, origin: 'generate', instruction: 'i', op_summary: null, parent_version_id: null, created_at: '' }], currentVersionSeq: 1 })
  useStore.getState().newDiagram()
  const s = useStore.getState()
  expect(s.nodes).toEqual([])
  expect(s.edges).toEqual([])
  expect(s.currentDiagram).toBeNull()
  expect(s.currentDiagramId).toBeNull()
  expect(s.versions).toEqual([])
  expect(s.currentVersionSeq).toBeNull()
  expect(s.uiState).toBe('idle')
  expect(s.generationPhase).toBe('idle')
  expect(s.trashedDiagram).toBeNull()
})

test('markCurrentTrashed vacía el canvas pero guarda info para restaurar', () => {
  useStore.getState().setCurrentDiagram(seed())
  useStore.setState({ currentDiagramId: 'x' })
  useStore.getState().markCurrentTrashed({ id: 'x', title: 'Tienda' })
  const s = useStore.getState()
  expect(s.nodes).toEqual([])
  expect(s.currentDiagram).toBeNull()
  expect(s.currentDiagramId).toBeNull()
  expect(s.trashedDiagram).toEqual({ id: 'x', title: 'Tienda' })
})

test('clearTrashed limpia el limbo de papelera', () => {
  useStore.setState({ trashedDiagram: { id: 'x', title: 'T' } })
  useStore.getState().clearTrashed()
  expect(useStore.getState().trashedDiagram).toBeNull()
})

test('importDiagram arranca sesión limpia con el diagrama importado (sin id en BD)', () => {
  useStore.setState({ currentDiagramId: 'previo', versions: [{ id: 'v', seq: 1, origin: 'generate', instruction: 'i', op_summary: null, parent_version_id: null, created_at: '' }] })
  const diagram = seed()
  useStore.getState().importDiagram(diagram)
  const s = useStore.getState()
  expect(s.currentDiagram).toBe(diagram)
  expect(s.nodes).toBe(diagram.nodes)
  expect(s.edges).toBe(diagram.edges)
  expect(s.currentDiagramId).toBeNull()
  expect(s.versions).toEqual([])
  expect(s.uiState).toBe('ready')
  expect(s.generationPhase).toBe('done')
})

// ── setGroupGeometry ────────────────────────────────────────────────────────

test('setGroupGeometry escribe la geometría del contenedor en group_layout', () => {
  useStore.getState().setCurrentDiagram(seed())
  useStore.getState().setGroupGeometry('c1', { x: 5, y: 6, width: 200, height: 100 })
  const gl = useStore.getState().currentDiagram!.group_layout!
  expect(gl.c1).toEqual({ x: 5, y: 6, width: 200, height: 100 })
})

test('setGroupGeometry conserva geometrías previas de otros contenedores', () => {
  useStore.getState().setCurrentDiagram({ ...seed(), group_layout: { c0: { x: 0, y: 0, width: 1, height: 1 } } })
  useStore.getState().setGroupGeometry('c1', { x: 5, y: 6, width: 200, height: 100 })
  const gl = useStore.getState().currentDiagram!.group_layout!
  expect(gl.c0).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  expect(gl.c1).toEqual({ x: 5, y: 6, width: 200, height: 100 })
})

test('setGroupGeometry es no-op si no hay diagrama vivo', () => {
  useStore.getState().setGroupGeometry('c1', { x: 0, y: 0, width: 1, height: 1 })
  expect(useStore.getState().currentDiagram).toBeNull()
})

// ── moveEdge ────────────────────────────────────────────────────────────────

test('moveEdge reordena la arista a la posición indicada', () => {
  useStore.setState({
    edges: [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
      { id: 'e3', source: 'c', target: 'd' },
    ] as never,
    currentDiagram: {
      title: 'T', diagram_type: 'sequence' as DiagramType, nodes: [],
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'c' },
        { id: 'e3', source: 'c', target: 'd' },
      ],
    } as never,
  })
  // Mueve e3 al inicio (índice 0).
  useStore.getState().moveEdge('e3', 0)
  expect(useStore.getState().edges.map((e) => e.id)).toEqual(['e3', 'e1', 'e2'])
  expect(useStore.getState().currentDiagram!.edges.map((e) => e.id)).toEqual(['e3', 'e1', 'e2'])
})

test('moveEdge soltado en el mismo slot es no-op (no cambia el orden)', () => {
  const edges = [
    { id: 'e1', source: 'a', target: 'b' },
    { id: 'e2', source: 'b', target: 'c' },
  ]
  useStore.setState({ edges: edges as never })
  const ref = useStore.getState().edges
  // Mover e1 al índice 0 (donde ya está) → no-op.
  useStore.getState().moveEdge('e1', 0)
  expect(useStore.getState().edges).toBe(ref)
})

test('moveEdge con id inexistente es no-op', () => {
  const edges = [{ id: 'e1', source: 'a', target: 'b' }]
  useStore.setState({ edges: edges as never })
  const ref = useStore.getState().edges
  useStore.getState().moveEdge('no-existe', 0)
  expect(useStore.getState().edges).toBe(ref)
})

// ── setStreamingType ────────────────────────────────────────────────────────

test('setStreamingType fija tipo/título y, con diagrama sembrado, los aplica al vuelo', () => {
  useStore.getState().setCurrentDiagram({ title: 'viejo', diagram_type: 'erd' as DiagramType, nodes: [], edges: [] })
  useStore.getState().setStreamingType('sequence' as DiagramType, 'Login')
  const s = useStore.getState()
  expect(s.streamingType).toBe('sequence')
  expect(s.streamingTitle).toBe('Login')
  expect(s.currentDiagram!.diagram_type).toBe('sequence')
  expect(s.currentDiagram!.title).toBe('Login')
})

test('setStreamingType sin diagrama sembrado solo guarda tipo/título', () => {
  useStore.getState().setStreamingType('flowchart' as DiagramType, 'Flujo')
  const s = useStore.getState()
  expect(s.streamingType).toBe('flowchart')
  expect(s.streamingTitle).toBe('Flujo')
  expect(s.currentDiagram).toBeNull()
})

// ── saving / saveError flags ────────────────────────────────────────────────

test('setSaving y setSaveError actualizan los flags observables del autoguardado', () => {
  useStore.getState().setSaving(true)
  expect(useStore.getState().saving).toBe(true)
  useStore.getState().setSaveError('boom')
  expect(useStore.getState().saveError).toBe('boom')
  useStore.getState().setSaving(false)
  useStore.getState().setSaveError(null)
  expect(useStore.getState().saving).toBe(false)
  expect(useStore.getState().saveError).toBeNull()
})

// ── renameCurrentDiagram ────────────────────────────────────────────────────

test('renameCurrentDiagram con id en BD usa el endpoint dedicado (renameDiagram)', () => {
  useStore.getState().setCurrentDiagram(seed())
  useStore.setState({ currentDiagramId: 'db-id' })
  useStore.getState().renameCurrentDiagram('Nuevo título')
  expect(useStore.getState().currentDiagram!.title).toBe('Nuevo título')
  expect(renameMock).toHaveBeenCalledWith('db-id', 'Nuevo título')
})

test('renameCurrentDiagram sin id en BD dispara el autosave (schedulePersist)', async () => {
  vi.useFakeTimers()
  try {
    useStore.getState().setCurrentDiagram(seed())
    useStore.setState({ currentDiagramId: null, uiState: 'ready' })
    useStore.getState().renameCurrentDiagram('Sin guardar')
    expect(useStore.getState().currentDiagram!.title).toBe('Sin guardar')
    expect(renameMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(900)
    expect(persistMock).toHaveBeenCalled()
  } finally {
    vi.useRealTimers()
  }
})

test('renameCurrentDiagram es no-op si no hay diagrama vivo', () => {
  useStore.getState().renameCurrentDiagram('X')
  expect(renameMock).not.toHaveBeenCalled()
  expect(useStore.getState().currentDiagram).toBeNull()
})

// ── schedulePersist: ruta de autoguardado debounced ─────────────────────────

test('schedulePersist: una edición manual en ready dispara persist tras 800ms y mueve los flags', async () => {
  vi.useFakeTimers()
  try {
    useStore.getState().setCurrentDiagram(seed())
    useStore.setState({ uiState: 'ready', currentVersionSeq: 5 })
    // updateNode dispara schedulePersist.
    useStore.getState().updateNode('a', { label: 'A2' })
    // Edición manual hace divergir el canvas inmediatamente.
    expect(useStore.getState().currentVersionSeq).toBeNull()
    expect(persistMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(800)
    expect(persistMock).toHaveBeenCalledWith({ origin: 'manual_edit' })
    // La versión devuelta se añadió al diario y el flag saving volvió a false.
    expect(useStore.getState().versions.some((v) => v.id === 'v-auto')).toBe(true)
    expect(useStore.getState().saving).toBe(false)
    expect(useStore.getState().saveError).toBeNull()
  } finally {
    vi.useRealTimers()
  }
})

test('schedulePersist NO persiste si uiState != ready (edición del agente en streaming)', async () => {
  vi.useFakeTimers()
  try {
    useStore.getState().setCurrentDiagram(seed())
    useStore.setState({ uiState: 'generating' as never })
    useStore.getState().updateNode('a', { label: 'A2' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(persistMock).not.toHaveBeenCalled()
  } finally {
    vi.useRealTimers()
  }
})

test('schedulePersist: ráfaga de ediciones coalesce en un único guardado', async () => {
  vi.useFakeTimers()
  try {
    useStore.getState().setCurrentDiagram(seed())
    useStore.setState({ uiState: 'ready' })
    useStore.getState().updateNode('a', { label: 'A1' })
    await vi.advanceTimersByTimeAsync(400)
    useStore.getState().updateNode('a', { label: 'A2' })
    await vi.advanceTimersByTimeAsync(400)
    // Aún no han pasado 800ms desde la última edición.
    expect(persistMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(400)
    expect(persistMock).toHaveBeenCalledTimes(1)
  } finally {
    vi.useRealTimers()
  }
})

afterEach(() => {
  vi.useRealTimers()
})
