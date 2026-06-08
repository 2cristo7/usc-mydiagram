import { test, expect, describe } from 'vitest';
import { diagramImportSchema } from '../types';
import type { DiagramSchema } from '../types';

// S8.3 — round-trip del export/import JSON (S8.2). El export serializa el
// DiagramSchema COMPLETO; el import lo valida con `diagramImportSchema` antes de
// tocar el canvas. Estos tests fijan: (1) un diagrama exportado se reimporta
// idéntico —incluido `title`, a diferencia de `diagramToJson`—, y (2) el schema
// rechaza lo que dejaría el canvas silenciosamente roto (huérfanas, enums fuera
// de rango, forma inválida).

const diagram: DiagramSchema = {
    title: 'Tienda online',
    diagram_type: 'erd',
    nodes: [
        { id: 'usuario', node_type: 'table', label: 'Usuario', attributes: ['id PK', 'email'] },
        { id: 'pedido', node_type: 'table', label: 'Pedido', attributes: [] },
    ],
    edges: [
        { id: 'e1', source: 'usuario', target: 'pedido', edge_type: 'one_to_many', label: 'realiza' },
    ],
};

// Simula export → fichero → import: lo que se descarga es JSON.stringify(currentDiagram)
// y lo que se importa pasa por JSON.parse + el schema.
function roundTrip(d: unknown) {
    return diagramImportSchema.safeParse(JSON.parse(JSON.stringify(d)));
}

describe('round-trip export → import', () => {
    test('un diagrama exportado se reimporta idéntico', () => {
        const result = roundTrip(diagram);
        expect(result.success).toBe(true);
        if (result.success) expect(result.data).toEqual(diagram);
    });

    test('conserva el title (a diferencia del CompactDiagram del agente)', () => {
        const result = roundTrip(diagram);
        expect(result.success && result.data.title).toBe('Tienda online');
    });
});

describe('validación del import — rechaza lo que rompería el canvas', () => {
    test('rechaza arista huérfana (target inexistente)', () => {
        const roto = {
            ...diagram,
            edges: [{ id: 'e1', source: 'usuario', target: 'fantasma', edge_type: 'one_to_many', label: 'x' }],
        };
        expect(roundTrip(roto).success).toBe(false);
    });

    test('rechaza edge_type fuera del enum', () => {
        const roto = {
            ...diagram,
            edges: [{ id: 'e1', source: 'usuario', target: 'pedido', edge_type: 'relates_to', label: 'x' }],
        };
        expect(roundTrip(roto).success).toBe(false);
    });

    test('rechaza node_type fuera del enum', () => {
        const roto = {
            ...diagram,
            nodes: [{ id: 'usuario', node_type: 'banana', label: 'U', attributes: [] }, diagram.nodes[1]],
        };
        expect(roundTrip(roto).success).toBe(false);
    });

    test('rechaza diagram_type fuera del enum', () => {
        expect(roundTrip({ ...diagram, diagram_type: 'mapa_mental' }).success).toBe(false);
    });

    test('rechaza forma inválida (nodes no es un array)', () => {
        expect(roundTrip({ ...diagram, nodes: 'no soy un array' }).success).toBe(false);
    });

    test('tolerante: nodo sin attributes → []', () => {
        const sinAttrs = {
            title: 't', diagram_type: 'erd',
            nodes: [{ id: 'a', node_type: 'table', label: 'A' }],
            edges: [],
        };
        const result = roundTrip(sinAttrs);
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.nodes[0].attributes).toEqual([]);
    });
});
