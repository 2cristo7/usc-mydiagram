import { expect, test, describe } from 'vitest'
import type { NodeType, EdgeType } from '../types'
import {
    stagingNodePositions,
    stagingEdges,
    STAGING_NODE_ROW_Y,
} from '../ui/utils/stagingLayout'

// Fixtures reutilizables
const makeNode = (id: string, label: string, node_type: NodeType = 'table') => ({
    id,
    label,
    node_type,
    attributes: [] as string[],
})

const makeEdge = (id: string, source: string, target: string, label = '') => ({
    id,
    source,
    target,
    label,
    edge_type: 'association' as EdgeType,
})

// ── stagingNodePositions ────────────────────────────────────────────────────

describe('stagingNodePositions', () => {
    test('sin nodos devuelve array vacío', () => {
        expect(stagingNodePositions([])).toEqual([])
    })

    test('todos los nodos se colocan en STAGING_NODE_ROW_Y', () => {
        const nodes = [makeNode('a', 'A'), makeNode('b', 'B'), makeNode('c', 'C')]
        const result = stagingNodePositions(nodes)
        for (const n of result) {
            expect(n.position.y).toBe(STAGING_NODE_ROW_Y)
        }
    })

    test('los nodos se ordenan horizontalmente: x crece con el índice', () => {
        const nodes = [makeNode('n1', 'Uno'), makeNode('n2', 'Dos'), makeNode('n3', 'Tres')]
        const result = stagingNodePositions(nodes)
        expect(result[0].position.x).toBeLessThan(result[1].position.x)
        expect(result[1].position.x).toBeLessThan(result[2].position.x)
    })

    test('el primer nodo comienza en x=0', () => {
        const result = stagingNodePositions([makeNode('n1', 'Solo')])
        expect(result[0].position.x).toBe(0)
    })

    test('todos los nodos tienen draggable=false durante staging', () => {
        const nodes = [makeNode('a', 'A'), makeNode('b', 'B')]
        const result = stagingNodePositions(nodes)
        for (const n of result) {
            expect(n.draggable).toBe(false)
        }
    })

    test('los ids coinciden con los del DiagramNode origen', () => {
        const nodes = [makeNode('foo', 'Foo'), makeNode('bar', 'Bar')]
        const result = stagingNodePositions(nodes)
        expect(result.map((n) => n.id)).toEqual(['foo', 'bar'])
    })

    test('nodo de tipo table → tipo React Flow table', () => {
        const result = stagingNodePositions([makeNode('x', 'X', 'table')])
        expect(result[0].type).toBe('table')
    })

    test('nodo de tipo use_case → tipo React Flow useCase', () => {
        const result = stagingNodePositions([makeNode('x', 'X', 'use_case')])
        expect(result[0].type).toBe('useCase')
    })

    test('nodo de tipo actor → tipo React Flow sequenceActor', () => {
        const result = stagingNodePositions([makeNode('x', 'X', 'actor')])
        expect(result[0].type).toBe('sequenceActor')
    })

    test('nodo de tipo system → tipo React Flow archIcon', () => {
        const result = stagingNodePositions([makeNode('x', 'X', 'system')])
        expect(result[0].type).toBe('archIcon')
    })
})

// ── stagingEdges ────────────────────────────────────────────────────────────

describe('stagingEdges', () => {
    test('sin aristas devuelve array vacío', () => {
        expect(stagingEdges([])).toEqual([])
    })

    test('los ids coinciden con los de la arista original', () => {
        const edges = [makeEdge('my-edge', 'a', 'b')]
        const result = stagingEdges(edges)
        expect(result[0].id).toBe('my-edge')
    })

    test('source y target se preservan', () => {
        const edges = [makeEdge('e1', 'nodeA', 'nodeB')]
        const result = stagingEdges(edges)
        expect(result[0].source).toBe('nodeA')
        expect(result[0].target).toBe('nodeB')
    })

    test('el label se expone en data.label', () => {
        const edges = [makeEdge('e1', 'a', 'b', 'usa')]
        const result = stagingEdges(edges)
        expect((result[0].data as { label: string }).label).toBe('usa')
    })

    test('arista sin label tiene data.label vacío', () => {
        const edges = [makeEdge('e1', 'a', 'b')]
        const result = stagingEdges(edges)
        expect((result[0].data as { label: string }).label).toBe('')
    })

    test('tipo de arista es default', () => {
        const edges = [makeEdge('e1', 'a', 'b')]
        const result = stagingEdges(edges)
        expect(result[0].type).toBe('default')
    })
})

// ── Constantes de posición ──────────────────────────────────────────────────

test('STAGING_NODE_ROW_Y es un número positivo', () => {
    expect(typeof STAGING_NODE_ROW_Y).toBe('number')
    expect(STAGING_NODE_ROW_Y).toBeGreaterThan(0)
})
