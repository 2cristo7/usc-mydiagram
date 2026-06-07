import { test, expect } from 'vitest';
import { diagramToJson } from '../ui/utils/diagramToJson';
import type { DiagramSchema } from '../types';

// S7.6 — diagramToJson es el contrato que CRUZA procesos (viaja en
// message:refine hasta el CompactDiagram de Pydantic). Estos tests fijan las
// dos decisiones de S7.1: qué se conserva (diagram_type, nodes/edges con ids)
// y qué se omite (title).

const diagram: DiagramSchema = {
    title: 'Tienda online',
    diagram_type: 'erd',
    nodes: [
        { id: 'usuario', node_type: 'table', label: 'Usuario', attributes: ['id PK', 'email'] },
        { id: 'pedido', node_type: 'table', label: 'Pedido' },
    ],
    edges: [
        { id: 'e1', source: 'usuario', target: 'pedido', edge_type: 'one_to_many', label: 'realiza' },
    ],
};

test('conserva diagram_type, nodes y edges con sus ids (la cirugía de las tools los necesita)', () => {
    const compact = diagramToJson(diagram);

    expect(compact.diagram_type).toBe('erd');
    expect(compact.nodes.map((n) => n.id)).toEqual(['usuario', 'pedido']);
    expect(compact.edges.map((e) => e.id)).toEqual(['e1']);
});

test('OMITE title: es human-facing, no contexto de refinamiento', () => {
    const compact = diagramToJson(diagram);

    expect('title' in compact).toBe(false);
    expect(Object.keys(compact).sort()).toEqual(['diagram_type', 'edges', 'nodes']);
});
