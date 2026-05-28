import { expect, test } from 'vitest'
import type { DiagramType, NodeType } from '../types'
import { DiagramToFlow } from '../ui/utils/diagramToFlow';


test('DiagramToFlow basic conversion', () => {
    const diagram = {
        title: 'Test Diagram',
        diagram_type: 'erd' as DiagramType,
        nodes: [
            { id: '1', label: 'Node 1', node_type: 'class' as NodeType, attributes: [] },
            { id: '2', label: 'Node 2', node_type: 'person' as NodeType, attributes: [] },
        ],
        edges: [
            { id: 'e1-2', source: '1', target: '2', label: 'Edge from Node 1 to Node 2' }
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
            label: 'Edge from Node 1 to Node 2'
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

test ('DiagramToFlow sequence diagram layout', () => {
    const diagram = {
        title: 'Sequence Diagram',
        diagram_type: 'sequence' as DiagramType,
        nodes: [
            { id: '1', label: 'Actor 1', node_type: 'actor' as NodeType, attributes: [] },
            { id: '2', label: 'Actor 2', node_type: 'actor' as NodeType, attributes: [] },
        ],
        edges: [
            { id: 'e1-2', source: '1', target: '2', label: 'Message from Actor 1 to Actor 2' }
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
            { id: 'e1-2', source: '1', target: '2', label: 'Edge from Node 1 to Node 2' }
        ]
    };

    const { edges } = DiagramToFlow(diagram);

    expect(edges).toEqual([
        {
            id: 'e1-2',
            source: '1',
            target: '2',
            label: 'Edge from Node 1 to Node 2'
        }
    ]);
});