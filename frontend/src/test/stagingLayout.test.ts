import { expect, test, describe } from 'vitest'
import type { NodeType, EdgeType } from '../types'
import {
    stagingNodePositions,
    stagingEdgeChipPositions,
    STAGING_NODE_ROW_Y,
    STAGING_EDGE_ROW_Y,
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

    test('nodo de tipo class → tipo React Flow umlClass', () => {
        const result = stagingNodePositions([makeNode('x', 'X', 'class')])
        expect(result[0].type).toBe('umlClass')
    })

    test('nodo de tipo actor → tipo React Flow sequenceActor', () => {
        const result = stagingNodePositions([makeNode('x', 'X', 'actor')])
        expect(result[0].type).toBe('sequenceActor')
    })

    test('nodo de tipo state → tipo React Flow state', () => {
        const result = stagingNodePositions([makeNode('x', 'X', 'state')])
        expect(result[0].type).toBe('state')
    })
})

// ── stagingEdgeChipPositions ────────────────────────────────────────────────

describe('stagingEdgeChipPositions', () => {
    test('sin aristas devuelve array vacío', () => {
        expect(stagingEdgeChipPositions([], [])).toEqual([])
    })

    test('todos los chips se colocan en STAGING_EDGE_ROW_Y', () => {
        const nodes = [makeNode('a', 'A'), makeNode('b', 'B')]
        const edges = [makeEdge('e1', 'a', 'b')]
        const result = stagingEdgeChipPositions(edges, nodes)
        for (const c of result) {
            expect(c.position.y).toBe(STAGING_EDGE_ROW_Y)
        }
    })

    test('los chips se ordenan horizontalmente igual que los nodos', () => {
        const nodes = [makeNode('a', 'A'), makeNode('b', 'B')]
        const edges = [
            makeEdge('e1', 'a', 'b'),
            makeEdge('e2', 'b', 'a'),
            makeEdge('e3', 'a', 'b'),
        ]
        const result = stagingEdgeChipPositions(edges, nodes)
        expect(result[0].position.x).toBeLessThan(result[1].position.x)
        expect(result[1].position.x).toBeLessThan(result[2].position.x)
    })

    test('el id del chip incluye el id de la arista original', () => {
        const nodes = [makeNode('a', 'A'), makeNode('b', 'B')]
        const edges = [makeEdge('my-edge', 'a', 'b')]
        const result = stagingEdgeChipPositions(edges, nodes)
        expect(result[0].id).toContain('my-edge')
    })

    test('type de los chips es edgeChip', () => {
        const nodes = [makeNode('a', 'A'), makeNode('b', 'B')]
        const edges = [makeEdge('e1', 'a', 'b')]
        const result = stagingEdgeChipPositions(edges, nodes)
        expect(result[0].type).toBe('edgeChip')
    })

    test('data del chip incluye los labels del source y target', () => {
        const nodes = [makeNode('s', 'Servidor'), makeNode('c', 'Cliente')]
        const edges = [makeEdge('e1', 's', 'c', 'llama')]
        const result = stagingEdgeChipPositions(edges, nodes)
        const data = result[0].data as { sourceLabel: string; targetLabel: string; edgeLabel: string }
        expect(data.sourceLabel).toBe('Servidor')
        expect(data.targetLabel).toBe('Cliente')
        expect(data.edgeLabel).toBe('llama')
    })

    test('si el nodo no se encuentra en la lista, usa el id como label', () => {
        const edges = [makeEdge('e1', 'nodo-inexistente', 'otro-inexistente')]
        const result = stagingEdgeChipPositions(edges, [])
        const data = result[0].data as { sourceLabel: string; targetLabel: string }
        expect(data.sourceLabel).toBe('nodo-inexistente')
        expect(data.targetLabel).toBe('otro-inexistente')
    })

    test('todos los chips tienen draggable=false y connectable=false', () => {
        const nodes = [makeNode('a', 'A'), makeNode('b', 'B')]
        const edges = [makeEdge('e1', 'a', 'b')]
        const result = stagingEdgeChipPositions(edges, nodes)
        expect(result[0].draggable).toBe(false)
        expect(result[0].connectable).toBe(false)
    })
})

// ── Constantes de posición ──────────────────────────────────────────────────

test('STAGING_NODE_ROW_Y es un número positivo menor que STAGING_EDGE_ROW_Y', () => {
    expect(typeof STAGING_NODE_ROW_Y).toBe('number')
    expect(STAGING_NODE_ROW_Y).toBeGreaterThan(0)
    expect(STAGING_NODE_ROW_Y).toBeLessThan(STAGING_EDGE_ROW_Y)
})
