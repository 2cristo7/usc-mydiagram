/**
 * Tests de integración store — añadir nodo desde la paleta.
 * Verifica: node_type correcto, label por defecto, position asignada,
 * y que el nodo queda en nodes[] + currentDiagram.nodes[].
 */

import { beforeEach, describe, it, expect, vi } from 'vitest'
import { useStore } from '../store'
import type { DiagramType, NodeType } from '../types'

// Mock de api para no disparar fetch en tests de store.
vi.mock('../lib/api', () => ({
  persistCurrentDiagram: vi.fn(() => Promise.resolve({ ok: true })),
}))

const erdDiagram = () => ({
  title: 'Test ERD',
  diagram_type: 'erd' as DiagramType,
  nodes: [
    { id: 'users', label: 'Users', node_type: 'table' as NodeType, attributes: [], position: { x: 100, y: 100 } },
  ],
  edges: [],
})

const flowchartDiagram = () => ({
  title: 'Test Flowchart',
  diagram_type: 'flowchart' as DiagramType,
  nodes: [],
  edges: [],
})

beforeEach(() => {
  useStore.setState({
    messages: [],
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

describe('addNode desde paleta', () => {
  it('el nodo añadido aparece en nodes[] y currentDiagram.nodes[]', () => {
    useStore.getState().setCurrentDiagram(erdDiagram())
    useStore.getState().addNode({
      id: 'table_new',
      label: 'Nuevo Tabla',
      node_type: 'table',
      attributes: [],
      position: { x: 200, y: 150 },
    })

    const { nodes, currentDiagram } = useStore.getState()
    expect(nodes.some((n) => n.id === 'table_new')).toBe(true)
    expect(currentDiagram!.nodes.some((n) => n.id === 'table_new')).toBe(true)
  })

  it('el nodo añadido conserva el node_type elegido', () => {
    useStore.getState().setCurrentDiagram(flowchartDiagram())
    useStore.getState().addNode({
      id: 'dec_1',
      label: 'Nuevo Decisión',
      node_type: 'decision',
      attributes: [],
      position: { x: 300, y: 200 },
    })

    const added = useStore.getState().nodes.find((n) => n.id === 'dec_1')
    expect(added?.node_type).toBe('decision')
  })

  it('el nodo añadido tiene la posición explícita pasada', () => {
    useStore.getState().setCurrentDiagram(flowchartDiagram())
    const pos = { x: 400, y: 250 }
    useStore.getState().addNode({
      id: 'step_1',
      label: 'Nuevo Paso',
      node_type: 'step',
      attributes: [],
      position: pos,
    })

    const added = useStore.getState().nodes.find((n) => n.id === 'step_1')
    expect(added?.position).toEqual(pos)
  })

  it('añadir múltiples nodos los acumula todos', () => {
    useStore.getState().setCurrentDiagram(flowchartDiagram())
    useStore.getState().addNode({
      id: 'term_start', label: 'Inicio', node_type: 'terminator', attributes: [], position: { x: 0, y: 0 },
    })
    useStore.getState().addNode({
      id: 'step_a', label: 'Paso A', node_type: 'step', attributes: [], position: { x: 0, y: 100 },
    })
    useStore.getState().addNode({
      id: 'dec_a', label: 'Decisión A', node_type: 'decision', attributes: [], position: { x: 0, y: 200 },
    })

    expect(useStore.getState().nodes).toHaveLength(3)
    expect(useStore.getState().currentDiagram!.nodes).toHaveLength(3)
  })

  it('updateNodePosition congela posición del nodo existente antes de añadir otro', () => {
    useStore.getState().setCurrentDiagram(erdDiagram())

    // Simula lo que hace NodePalette: congela posición de nodos sin position
    // (en este caso ya tienen position, así que no debería cambiar nada)
    const frozenPos = { x: 999, y: 888 }
    useStore.getState().updateNodePosition('users', frozenPos)

    useStore.getState().addNode({
      id: 'table_2', label: 'Nuevo Tabla', node_type: 'table', attributes: [], position: { x: 300, y: 50 },
    })

    // El nodo original conserva la posición congelada
    const original = useStore.getState().nodes.find((n) => n.id === 'users')
    expect(original?.position).toEqual(frozenPos)
    // El nuevo nodo está presente
    expect(useStore.getState().nodes.find((n) => n.id === 'table_2')).toBeDefined()
  })
})
