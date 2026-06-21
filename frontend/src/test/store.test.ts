import { beforeEach, expect, test, vi } from 'vitest'
import { useStore, selectPromptDraft, NEW_DRAFT_KEY } from '../store'
import type { DiagramType, NodeType } from '../types'
import type { GenerationPhase } from '../store'

// Mock de api para no disparar fetch en tests de store.
vi.mock('../lib/api', () => ({
    persistCurrentDiagram: vi.fn(() => Promise.resolve({ ok: true })),
}))

beforeEach(() => {
    useStore.setState({
      versions: [],
      currentVersionSeq: null,
      activeOperation: null,
      uiState: 'idle',
      generationPhase: 'idle',
      nodes: [],
      edges: [],
      currentDiagram: null,
      toolTrace: [],
      selectedDiagramType: null,
      lastGenerationType: null,
    })
  })

test('promptDrafts: el borrador es POR DIAGRAMA y se conserva al navegar', () => {
  useStore.setState({ promptDrafts: {}, currentDiagramId: null })

  // Diagrama nuevo/sin guardar: el borrador va al slot NEW_DRAFT_KEY.
  useStore.getState().setPromptDraft('ERD de tienda')
  expect(selectPromptDraft(useStore.getState())).toBe('ERD de tienda')
  expect(useStore.getState().promptDrafts[NEW_DRAFT_KEY]).toBe('ERD de tienda')

  // Navego a un diagrama guardado X: su slot está vacío (input limpio).
  useStore.setState({ currentDiagramId: 'X' })
  expect(selectPromptDraft(useStore.getState())).toBe('')
  useStore.getState().setPromptDraft('añade Carrito')
  expect(selectPromptDraft(useStore.getState())).toBe('añade Carrito')

  // Vuelvo al diagrama nuevo: reaparece su borrador, intacto.
  useStore.setState({ currentDiagramId: null })
  expect(selectPromptDraft(useStore.getState())).toBe('ERD de tienda')

  // Y el borrador de X sigue guardado bajo su id.
  useStore.setState({ currentDiagramId: 'X' })
  expect(selectPromptDraft(useStore.getState())).toBe('añade Carrito')
})

test('addVersion: añade al diario y el canvas pasa a coincidir con esa versión', () => {
  const v = { id: '1', seq: 1, origin: 'generate' as const, instruction: 'Crea un ERD', op_summary: null, parent_version_id: null, created_at: new Date().toISOString() }
  useStore.getState().addVersion(v)
  expect(useStore.getState().versions).toContain(v)
  expect(useStore.getState().currentVersionSeq).toBe(1)
})

test('headVersionId (ancla de orden) solo avanza con versiones del agente, no con manual_edit', () => {
  const gen = { id: 'g', seq: 1, origin: 'generate' as const, instruction: 'x', op_summary: null, parent_version_id: null, created_at: '' }
  const manual = { id: 'm', seq: 2, origin: 'manual_edit' as const, instruction: null, op_summary: null, parent_version_id: 'g', created_at: '' }
  const refine = { id: 'r', seq: 3, origin: 'refine' as const, instruction: 'y', op_summary: null, parent_version_id: 'm', created_at: '' }
  useStore.getState().addVersion(gen)
  expect(useStore.getState().headVersionId).toBe('g')
  useStore.getState().addVersion(manual) // manual NO mueve el ancla → la lista no se reordena
  expect(useStore.getState().headVersionId).toBe('g')
  useStore.getState().addVersion(refine) // refine SÍ mueve el ancla
  expect(useStore.getState().headVersionId).toBe('r')
})

test('una edición manual hace divergir el canvas (currentVersionSeq → null)', () => {
  useStore.getState().setCurrentDiagram({ title: 'T', diagram_type: 'erd' as DiagramType, nodes: [{ id: 'n1', label: 'A', node_type: 'table' as NodeType, attributes: [] }], edges: [] })
  useStore.setState({ uiState: 'ready', currentVersionSeq: 5 })
  useStore.getState().updateNode('n1', { label: 'B' })
  expect(useStore.getState().currentVersionSeq).toBeNull()
})

// S10.2 — tipo preseleccionado para la próxima generación.
test('selectedDiagramType: default null (automático) y se puede fijar/limpiar', () => {
  expect(useStore.getState().selectedDiagramType).toBeNull()
  useStore.getState().setSelectedDiagramType('flowchart' as DiagramType)
  expect(useStore.getState().selectedDiagramType).toBe('flowchart')
  useStore.getState().setSelectedDiagramType(null)
  expect(useStore.getState().selectedDiagramType).toBeNull()
})

test('lastGenerationType: recuerda el tipo que originó el diagrama (para regenerar)', () => {
  expect(useStore.getState().lastGenerationType).toBeNull()
  useStore.getState().setLastGenerationType('sequence' as DiagramType)
  expect(useStore.getState().lastGenerationType).toBe('sequence')
})

test('setCurrentDiagram', () => {
  const diagram = { title: 'Test Diagram', diagram_type: 'erd' as DiagramType, nodes: [], edges: [] }
  useStore.getState().setCurrentDiagram(diagram)
  expect(useStore.getState().currentDiagram).toEqual(diagram)
  expect(useStore.getState().nodes).toEqual(diagram.nodes)
  expect(useStore.getState().edges).toEqual(diagram.edges)
})

test('updateNode', () => {
  useStore.setState({ nodes: [
    { id: '1', label: 'Nodo A', node_type: 'table' as NodeType, attributes: [] },
    { id: '2', label: 'Nodo B', node_type: 'table' as NodeType, attributes: [] },
  ]})
  useStore.getState().updateNode('1', { label: 'Nodo A modificado' })
  expect(useStore.getState().nodes).toEqual([
    { id: '1', label: 'Nodo A modificado', node_type: 'table' as NodeType, attributes: [] },
    { id: '2', label: 'Nodo B', node_type: 'table' as NodeType, attributes: [] },
  ])
})

test('updateNodePosition actualiza position en nodes[] y en currentDiagram.nodes[]', () => {
  const diagram = {
    title: 'Test',
    diagram_type: 'erd' as DiagramType,
    nodes: [
      { id: 'n1', label: 'Tabla A', node_type: 'table' as NodeType, attributes: [] },
      { id: 'n2', label: 'Tabla B', node_type: 'table' as NodeType, attributes: [] },
    ],
    edges: [],
  }
  useStore.getState().setCurrentDiagram(diagram)
  useStore.getState().updateNodePosition('n1', { x: 123, y: 456 })

  const { nodes, currentDiagram } = useStore.getState()
  expect(nodes.find((n) => n.id === 'n1')?.position).toEqual({ x: 123, y: 456 })
  expect(nodes.find((n) => n.id === 'n2')?.position).toBeUndefined()
  expect(currentDiagram!.nodes.find((n) => n.id === 'n1')?.position).toEqual({ x: 123, y: 456 })
})

test('addNode', () => {
  const newNode = { id: '3', label: 'Nodo C', node_type: 'table' as NodeType, attributes: [] }
  useStore.setState({
    currentDiagram: { title: 'Test', diagram_type: 'erd' as DiagramType, nodes: [], edges: [] }
  })
  useStore.getState().addNode(newNode)
  expect(useStore.getState().nodes).toContain(newNode)
  expect(useStore.getState().currentDiagram!.nodes).toContain(newNode)
})

// --- S7.5 — deltas del agente y reconciliación del done ---

const erdSeed = () => ({
  title: 'Tienda',
  diagram_type: 'erd' as DiagramType,
  nodes: [
    { id: 'usuario', label: 'Usuario', node_type: 'table' as NodeType, attributes: [] },
    { id: 'producto', label: 'Producto', node_type: 'table' as NodeType, attributes: [] },
  ],
  edges: [
    { id: 'usuario__producto', source: 'usuario', target: 'producto', label: 'compra', edge_type: 'many_to_many' as const },
  ],
})

test('removeNode aplica el cascade DECLARADO por el servidor, sin reinferirlo', () => {
  useStore.getState().setCurrentDiagram(erdSeed())
  useStore.getState().removeNode('usuario', ['usuario__producto'])
  const { nodes, edges, currentDiagram } = useStore.getState()
  expect(nodes.map((n) => n.id)).toEqual(['producto'])
  expect(edges).toEqual([])
  expect(currentDiagram!.nodes.map((n) => n.id)).toEqual(['producto'])
})

test('removeNode NO toca aristas fuera de la lista declarada', () => {
  // Si el servidor no declaró una arista en deleted_edges, el cliente no la
  // borra por su cuenta (cliente tonto: el done reconciliará si hiciera falta).
  useStore.getState().setCurrentDiagram(erdSeed())
  useStore.getState().removeNode('usuario', [])
  expect(useStore.getState().edges.map((e) => e.id)).toEqual(['usuario__producto'])
})

test('removeEdge elimina solo esa arista', () => {
  useStore.getState().setCurrentDiagram(erdSeed())
  useStore.getState().removeEdge('usuario__producto')
  expect(useStore.getState().edges).toEqual([])
  expect(useStore.getState().nodes).toHaveLength(2)
})

test('applyDiagram con estado idéntico NO reemplaza las referencias (guarda de idempotencia)', () => {
  useStore.getState().setCurrentDiagram(erdSeed())
  const before = useStore.getState()
  // Snapshot estructuralmente idéntico pero objetos nuevos (como llegaría del done).
  useStore.getState().applyDiagram(erdSeed())
  const after = useStore.getState()
  expect(after.currentDiagram).toBe(before.currentDiagram)
  expect(after.nodes).toBe(before.nodes)
})

test('applyDiagram con estado distinto reemplaza (reconciliación del done)', () => {
  useStore.getState().setCurrentDiagram(erdSeed())
  const snapshot = erdSeed()
  snapshot.nodes.push({ id: 'carrito', label: 'Carrito', node_type: 'table' as NodeType, attributes: [] })
  useStore.getState().applyDiagram(snapshot)
  expect(useStore.getState().nodes.map((n) => n.id)).toContain('carrito')
  expect(useStore.getState().currentDiagram!.nodes).toHaveLength(3)
})

// ── Fases de generación (generationPhase) ──────────────────────────────────

test('generationPhase: valor inicial es idle', () => {
  expect(useStore.getState().generationPhase).toBe('idle')
})

test('generationPhase: transición idle → live al iniciar streaming', () => {
  useStore.getState().setGenerationPhase('live' as GenerationPhase)
  expect(useStore.getState().generationPhase).toBe('live')
})

test('generationPhase: transición live → done al terminar el montaje en vivo', () => {
  useStore.getState().setGenerationPhase('live' as GenerationPhase)
  useStore.getState().setGenerationPhase('done' as GenerationPhase)
  expect(useStore.getState().generationPhase).toBe('done')
})

test('generationPhase: cargar diagrama existente (setCurrentDiagram) NO entra en live', () => {
  // Simula carga desde historial: setCurrentDiagram nunca toca generationPhase.
  const diagram = { title: 'Test', diagram_type: 'erd' as DiagramType, nodes: [], edges: [] }
  useStore.getState().setCurrentDiagram(diagram)
  // La fase sigue en 'idle' (o el valor que tenía), no en 'live'.
  expect(useStore.getState().generationPhase).toBe('idle')
})

test('generationPhase: error de generación vuelve a idle', () => {
  useStore.getState().setGenerationPhase('live' as GenerationPhase)
  // En useWebSocket, diagram:error llama a setGenerationPhase('idle')
  useStore.getState().setGenerationPhase('idle' as GenerationPhase)
  expect(useStore.getState().generationPhase).toBe('idle')
})

// ── clearDiagramContent — limpieza previa al regenerar ────────────────────────

test('clearDiagramContent vacía nodes/edges conservando id/title/diagram_type', () => {
  const diagram = erdSeed()
  useStore.getState().setCurrentDiagram(diagram)

  useStore.getState().clearDiagramContent()

  const { nodes, edges, currentDiagram } = useStore.getState()
  expect(nodes).toEqual([])
  expect(edges).toEqual([])
  // currentDiagram sigue existiendo, con los metadatos originales
  expect(currentDiagram).not.toBeNull()
  expect(currentDiagram!.title).toBe(diagram.title)
  expect(currentDiagram!.diagram_type).toBe(diagram.diagram_type)
  expect(currentDiagram!.nodes).toEqual([])
  expect(currentDiagram!.edges).toEqual([])
})

test('clearDiagramContent es no-op si no hay diagrama vivo', () => {
  // currentDiagram ya es null por el beforeEach
  useStore.getState().clearDiagramContent()
  expect(useStore.getState().nodes).toEqual([])
  expect(useStore.getState().edges).toEqual([])
  expect(useStore.getState().currentDiagram).toBeNull()
})

test('clearDiagramContent: applyDiagram posterior reconcilia sobre el mismo diagrama', () => {
  const diagram = erdSeed()
  useStore.getState().setCurrentDiagram(diagram)
  useStore.getState().clearDiagramContent()

  // Simula el done: snapshot con nodos nuevos, mismo diagram_type
  const snapshot = {
    ...erdSeed(),
    nodes: [
      ...erdSeed().nodes,
      { id: 'carrito', label: 'Carrito', node_type: 'table' as import('../types').NodeType, attributes: [] },
    ],
  }
  useStore.getState().applyDiagram(snapshot)

  const { nodes, currentDiagram } = useStore.getState()
  expect(nodes).toHaveLength(3)
  expect(currentDiagram!.diagram_type).toBe('erd')
})

test('traza de tool calls: running al pedirse, ok/error al resolverse', () => {
  const { traceToolCall, traceToolResult } = useStore.getState()
  traceToolCall({ id: 'c1', tool: 'add_node', args: { label: 'Carrito' } })
  traceToolCall({ id: 'c2', tool: 'add_edge', args: {} })
  expect(useStore.getState().toolTrace.map((e) => e.status)).toEqual(['running', 'running'])

  traceToolResult('c1', 'ok')
  traceToolResult('c2', 'error')
  expect(useStore.getState().toolTrace.map((e) => e.status)).toEqual(['ok', 'error'])

  useStore.getState().clearToolTrace()
  expect(useStore.getState().toolTrace).toEqual([])
})