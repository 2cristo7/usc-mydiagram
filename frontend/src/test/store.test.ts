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
    })
  })

test('addMessage', () => {
  const message = { id: '1', text: 'Hello, world!', sender: 'user' as const, timestamp: new Date() }
  useStore.getState().addMessage(message)
  expect(useStore.getState().messages).toContain(message)
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