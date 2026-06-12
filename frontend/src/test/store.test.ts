import { beforeEach, expect, test } from 'vitest'
import { useStore } from '../store'
import type { DiagramType, NodeType } from '../types'

beforeEach(() => {
    useStore.setState({
      messages: [],
      uiState: 'idle',
      nodes: [],
      edges: [],
      currentDiagram: null,
      toolTrace: [],
      selectedDiagramType: null,
      lastGenerationType: null,
    })
  })

test('addMessage', () => {
  const message = { id: '1', text: 'Hello, world!', sender: 'user' as const, timestamp: new Date() }
  useStore.getState().addMessage(message)
  expect(useStore.getState().messages).toContain(message)
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