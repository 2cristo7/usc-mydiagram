import { expect, test, vi } from 'vitest'
import type { DiagramType, NodeType, EdgeType } from '../types'
import type { DiagramSchema } from '../types'
import { DiagramToFlow } from '../ui/utils/diagramToFlow';

vi.mock('../ui/utils/sequenceLayout', () => ({
    sequenceLayout: vi.fn(() => ({ nodes: [], edges: [] }))
}));


test('DiagramToFlow basic conversion', () => {
    const diagram = {
        title: 'Test Diagram',
        diagram_type: 'erd' as DiagramType,
        nodes: [
            { id: '1', label: 'Node 1', node_type: 'class' as NodeType, attributes: [] },
            { id: '2', label: 'Node 2', node_type: 'person' as NodeType, attributes: [] },
        ],
        edges: [
            { id: 'e1-2', source: '1', target: '2', label: 'Edge from Node 1 to Node 2', edge_type: 'association' as EdgeType }
        ]
    };

    const { nodes, edges } = DiagramToFlow(diagram);

    expect(nodes).toEqual([
        {
            id: '1',
            position: expect.any(Object),
            data: { label: 'Node 1', nodeType: 'class', attributes: [] },
            type: 'umlClass'
        },
        {
            id: '2',
            position: expect.any(Object),
            data: { label: 'Node 2', nodeType: 'person', attributes: [] },
            type: 'c4'
        }
    ]);

    expect(edges).toEqual([
        {
            id: 'e1-2',
            source: '1',
            target: '2',
            sourceHandle: null,
            targetHandle: null,
            data: { label: 'Edge from Node 1 to Node 2' },
            type: 'default',
        }
    ]);
});

test ('DiagramToFlow with empty diagram', () => {
    const diagram = {
        title: 'Empty Diagram',
        diagram_type: 'uml_class' as DiagramType,
        nodes: [],
        edges: []
    };

    const { nodes, edges } = DiagramToFlow(diagram);

    expect(nodes).toEqual([]);
    expect(edges).toEqual([]);
});

test('DiagramToFlow with unknown node type', () => {
    const diagram = {
        title: 'Unknown Node Type Diagram',
        diagram_type: 'flowchart' as DiagramType,
        nodes: [
            { id: '1', label: 'Node 1', node_type: 'unknown' as NodeType, attributes: [] },
        ],
        edges: []
    };

    const { nodes, edges } = DiagramToFlow(diagram);

    expect(nodes).toEqual([
        {
            id: '1',
            position: expect.any(Object),
            data: { label: 'Node 1', nodeType: 'unknown', attributes: [] },
            type: 'default'
        }
    ]);

    expect(edges).toEqual([]);
});

test ('DiagramToFlow with node register', () => {
    const diagram = {
        title: 'Node Register Diagram',
        diagram_type: 'erd' as DiagramType,
        nodes: [
            { id: '1', label: 'Node 1', node_type: 'class' as NodeType, attributes: [] },
            { id: '2', label: 'Node 2', node_type: 'class' as NodeType, attributes: [] },
        ],
        edges: []
    };

    const { nodes } = DiagramToFlow(diagram);

    expect(nodes).toEqual([
        {
            id: '1',
            position: expect.any(Object),
            data: { label: 'Node 1', nodeType: 'class', attributes: [] },
            type: 'umlClass'
        },
        {
            id: '2',
            position: expect.any(Object),
            data: { label: 'Node 2', nodeType: 'class', attributes: [] },
            type: 'umlClass'
        }
    ]);
});

// Skipped: sequenceLayout is a stub — Agente G implements it in Fase 1
test.skip('DiagramToFlow sequence diagram layout', () => {
    const diagram = {
        title: 'Sequence Diagram',
        diagram_type: 'sequence' as DiagramType,
        nodes: [
            { id: '1', label: 'Actor 1', node_type: 'actor' as NodeType, attributes: [] },
            { id: '2', label: 'Actor 2', node_type: 'actor' as NodeType, attributes: [] },
        ],
        edges: [
            { id: 'e1-2', source: '1', target: '2', label: 'Message from Actor 1 to Actor 2', edge_type: 'association' as EdgeType }
        ]
    };

    const { nodes } = DiagramToFlow(diagram);

    expect(nodes[0].position.x).toBeLessThan(nodes[1].position.x);
});

test ('DiagramToFlow edges mapping', () => {
    const diagram = {
        title: 'Edge Mapping Diagram',
        diagram_type: 'erd' as DiagramType,
        nodes: [
            { id: '1', label: 'Node 1', node_type: 'class' as NodeType, attributes: [] },
            { id: '2', label: 'Node 2', node_type: 'class' as NodeType, attributes: [] },
        ],
        edges: [
            { id: 'e1-2', source: '1', target: '2', label: 'Edge from Node 1 to Node 2', edge_type: 'association' as EdgeType }
        ]
    };

    const { edges } = DiagramToFlow(diagram);

    expect(edges).toEqual([
        {
            id: 'e1-2',
            source: '1',
            target: '2',
            sourceHandle: null,
            targetHandle: null,
            data: { label: 'Edge from Node 1 to Node 2' },
            type: 'default',
        }
    ]);
});

test('table node maps to type table', () => {
    const diagram: DiagramSchema = {
        title: 'ERD Diagram',
        diagram_type: 'erd' as DiagramType,
        nodes: [
            { id: '1', label: 'Users', node_type: 'table' as NodeType, attributes: [] }
        ],
        edges: []
    };

    const { nodes } = DiagramToFlow(diagram);

    expect(nodes[0].type).toBe('table');
});

test('state node maps to type state', () => {
    const diagram: DiagramSchema = {
        title: 'State Machine',
        diagram_type: 'state_machine' as DiagramType,
        nodes: [
            { id: '1', label: 'Idle', node_type: 'state' as NodeType, attributes: [] }
        ],
        edges: []
    };

    const { nodes } = DiagramToFlow(diagram);

    expect(nodes[0].type).toBe('state');
});

test('topic node maps to type mindmap', () => {
    const diagram: DiagramSchema = {
        title: 'Mind Map',
        diagram_type: 'mindmap' as DiagramType,
        nodes: [
            { id: '1', label: 'Central Idea', node_type: 'topic' as NodeType, attributes: [] }
        ],
        edges: []
    };

    const { nodes } = DiagramToFlow(diagram);

    expect(nodes[0].type).toBe('mindmap');
});

test('sequence diagram dispatches to sequenceLayout', async () => {
    const { sequenceLayout } = await import('../ui/utils/sequenceLayout');

    const diagram: DiagramSchema = {
        title: 'Sequence Diagram',
        diagram_type: 'sequence' as DiagramType,
        nodes: [
            { id: '1', label: 'Client', node_type: 'actor' as NodeType, attributes: [] }
        ],
        edges: []
    };

    DiagramToFlow(diagram);

    expect(sequenceLayout).toHaveBeenCalledWith(diagram);
});

test('nodo con position guardada usa esa posición y no la calculada por dagre', () => {
    const savedPos = { x: 999, y: 888 }
    const diagram: DiagramSchema = {
        title: 'Posición persistida',
        diagram_type: 'erd' as DiagramType,
        nodes: [
            { id: '1', label: 'Nodo A', node_type: 'table' as NodeType, attributes: [], position: savedPos },
            { id: '2', label: 'Nodo B', node_type: 'table' as NodeType, attributes: [] },
        ],
        edges: [],
    }

    const { nodes } = DiagramToFlow(diagram)

    // El nodo con posición guardada debe conservar exactamente esas coordenadas.
    const nodeA = nodes.find((n) => n.id === '1')!
    expect(nodeA.position).toEqual(savedPos)

    // El nodo sin posición guardada recibe la de dagre (cualquier número).
    const nodeB = nodes.find((n) => n.id === '2')!
    expect(typeof nodeB.position.x).toBe('number')
    expect(typeof nodeB.position.y).toBe('number')
});