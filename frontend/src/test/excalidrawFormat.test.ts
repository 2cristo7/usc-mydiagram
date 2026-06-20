import { test, expect, describe } from 'vitest';
import { excalidrawFormat } from '../ui/utils/formats/excalidraw';
import { toExcalidraw } from '../ui/utils/formats/excalidraw/export';
import { fromExcalidraw } from '../ui/utils/formats/excalidraw/import';
import { diagramImportSchema } from '../types';
import type { DiagramSchema } from '../types';

// Conversor Excalidraw ↔ modelo interno. El export es estructuralmente sin pérdida
// (nodos/aristas/labels/posiciones); el import es heurístico (importExperimental):
// recupera la topología pero NO la semántica de node_type/edge_type (Excalidraw no
// la representa), así que el round-trip se comprueba sobre forma, no sobre tipos.

const erd: DiagramSchema = {
  title: 'Tienda',
  diagram_type: 'erd',
  nodes: [
    { id: 'usuario', node_type: 'table', label: 'Usuario', attributes: ['id PK'], position: { x: 0, y: 0 } },
    { id: 'pedido', node_type: 'table', label: 'Pedido', attributes: [], position: { x: 300, y: 0 } },
  ],
  edges: [
    { id: 'e1', source: 'usuario', target: 'pedido', edge_type: 'one_to_many', label: 'realiza' },
  ],
};

const flow: DiagramSchema = {
  title: 'Login',
  diagram_type: 'flowchart',
  nodes: [
    { id: 'ini', node_type: 'terminator', label: 'Inicio', attributes: [] },
    { id: 'q', node_type: 'decision', label: '¿Válido?', attributes: [] },
    { id: 's', node_type: 'step', label: 'Entrar', attributes: [] },
  ],
  edges: [
    { id: 'a', source: 'ini', target: 'q', edge_type: 'flow', label: '' },
    { id: 'b', source: 'q', target: 's', edge_type: 'conditional', label: 'sí' },
  ],
};

describe('toExcalidraw — serialización', () => {
  test('produce JSON parseable con type:"excalidraw"', () => {
    const doc = JSON.parse(toExcalidraw(erd));
    expect(doc.type).toBe('excalidraw');
    expect(doc.version).toBe(2);
    expect(Array.isArray(doc.elements)).toBe(true);
  });

  test('es determinista (mismo diagrama → mismo JSON, sin random)', () => {
    expect(toExcalidraw(erd)).toBe(toExcalidraw(erd));
  });

  test('cada nodo da una forma con texto bound y boundElements coherentes', () => {
    const doc = JSON.parse(toExcalidraw(erd));
    const shapes = doc.elements.filter((e: any) => ['rectangle', 'ellipse', 'diamond'].includes(e.type));
    expect(shapes).toHaveLength(2);
    for (const s of shapes) {
      const textRef = s.boundElements.find((b: any) => b.type === 'text');
      expect(textRef).toBeDefined();
      const txt = doc.elements.find((e: any) => e.id === textRef.id);
      expect(txt.containerId).toBe(s.id);
    }
  });

  test('node_type → forma: decision=diamond, terminator=ellipse, step=rectangle', () => {
    const doc = JSON.parse(toExcalidraw(flow));
    const byLabel = (lbl: string) => {
      const txt = doc.elements.find((e: any) => e.type === 'text' && e.text === lbl);
      return doc.elements.find((e: any) => e.id === txt.containerId);
    };
    expect(byLabel('¿Válido?').type).toBe('diamond');
    expect(byLabel('Inicio').type).toBe('ellipse');
    expect(byLabel('Entrar').type).toBe('rectangle');
  });

  test('cada arista da una flecha con start/endBinding y referencia en las formas', () => {
    const doc = JSON.parse(toExcalidraw(erd));
    const arrows = doc.elements.filter((e: any) => e.type === 'arrow');
    expect(arrows).toHaveLength(1);
    const arrow = arrows[0];
    expect(arrow.startBinding.elementId).toBeDefined();
    expect(arrow.endBinding.elementId).toBeDefined();
    const src = doc.elements.find((e: any) => e.id === arrow.startBinding.elementId);
    expect(src.boundElements.some((b: any) => b.type === 'arrow' && b.id === arrow.id)).toBe(true);
    // La label de la arista es un text bound a la flecha.
    const lbl = doc.elements.find((e: any) => e.type === 'text' && e.containerId === arrow.id);
    expect(lbl.text).toBe('realiza');
  });
});

describe('fromExcalidraw — import heurístico', () => {
  test('round-trip export→import conserva nº de nodos/aristas y labels', () => {
    const text = toExcalidraw(erd);
    const back = fromExcalidraw(text, { diagramType: 'erd' });
    expect(back.diagram_type).toBe('erd');
    expect(back.nodes).toHaveLength(2);
    expect(back.edges).toHaveLength(1);
    expect(back.nodes.map((n) => n.label).sort()).toEqual(['Pedido', 'Usuario']);
    expect(back.edges[0].label).toBe('realiza');
    // El candidato pasa el contrato (integridad referencial incluida).
    expect(diagramImportSchema.safeParse(back).success).toBe(true);
  });

  test('round-trip conserva posiciones de los nodos', () => {
    const back = fromExcalidraw(toExcalidraw(erd), { diagramType: 'erd' });
    const usuario = back.nodes.find((n) => n.label === 'Usuario')!;
    expect(usuario.position).toEqual({ x: 0, y: 0 });
  });

  test('node_type/edge_type se acotan al diagram_type elegido', () => {
    const back = fromExcalidraw(toExcalidraw(flow), { diagramType: 'flowchart' });
    const valid = ['terminator', 'step', 'decision'];
    expect(back.nodes.every((n) => valid.includes(n.node_type))).toBe(true);
    // El diamante se mapea a decision.
    const dec = back.nodes.find((n) => n.label === '¿Válido?')!;
    expect(dec.node_type).toBe('decision');
    expect(back.edges.every((e) => ['flow', 'conditional'].includes(e.edge_type!))).toBe(true);
  });

  test('importa un .excalidraw mínimo hecho a mano', () => {
    const doc = {
      type: 'excalidraw',
      version: 2,
      source: 'https://excalidraw.com',
      elements: [
        { id: 'r1', type: 'rectangle', x: 10, y: 20, width: 160, height: 80, isDeleted: false, boundElements: [{ type: 'text', id: 't1' }] },
        { id: 't1', type: 'text', containerId: 'r1', text: 'Caja A', isDeleted: false },
        { id: 'r2', type: 'rectangle', x: 300, y: 20, width: 160, height: 80, isDeleted: false, boundElements: [] },
        { id: 'arr', type: 'arrow', x: 0, y: 0, startBinding: { elementId: 'r1' }, endBinding: { elementId: 'r2' }, isDeleted: false, boundElements: [] },
      ],
      appState: { viewBackgroundColor: '#ffffff' },
      files: {},
    };
    const back = fromExcalidraw(JSON.stringify(doc), { diagramType: 'architecture' });
    expect(back.nodes).toHaveLength(2);
    expect(back.edges).toHaveLength(1);
    expect(back.edges[0].source).toBe('r1');
    expect(back.edges[0].target).toBe('r2');
    expect(back.nodes.find((n) => n.id === 'r1')!.label).toBe('Caja A');
  });

  test('descarta formas borradas y flechas sin binding resoluble', () => {
    const doc = {
      type: 'excalidraw',
      version: 2,
      source: 'x',
      elements: [
        { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 1, height: 1, isDeleted: false, boundElements: [] },
        { id: 'rdel', type: 'rectangle', x: 0, y: 0, width: 1, height: 1, isDeleted: true, boundElements: [] },
        // Flecha hacia una forma inexistente: se descarta.
        { id: 'arr1', type: 'arrow', x: 0, y: 0, startBinding: { elementId: 'r1' }, endBinding: { elementId: 'fantasma' }, isDeleted: false, boundElements: [] },
        // Flecha sin endBinding: se descarta.
        { id: 'arr2', type: 'arrow', x: 0, y: 0, startBinding: { elementId: 'r1' }, endBinding: null, isDeleted: false, boundElements: [] },
      ],
      appState: { viewBackgroundColor: '#fff' },
      files: {},
    };
    const back = fromExcalidraw(JSON.stringify(doc), { diagramType: 'architecture' });
    expect(back.nodes).toHaveLength(1);
    expect(back.edges).toHaveLength(0);
  });
});

describe('excalidrawFormat — FormatModule', () => {
  test('expone capacidades correctas', () => {
    expect(excalidrawFormat.id).toBe('excalidraw');
    expect(excalidrawFormat.extension).toBe('excalidraw');
    expect(excalidrawFormat.canImport).toBe(true);
    expect(excalidrawFormat.canExport).toBe(true);
    expect(excalidrawFormat.importExperimental).toBe(true);
    expect(typeof excalidrawFormat.toContent).toBe('function');
    expect(typeof excalidrawFormat.fromContent).toBe('function');
  });
});
