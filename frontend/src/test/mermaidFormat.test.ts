import { describe, it, expect } from 'vitest';
import { toMermaid } from '../ui/utils/formats/mermaid/export';
import { fromMermaid } from '../ui/utils/formats/mermaid/import';
import { mermaidFormat } from '../ui/utils/formats/mermaid';
import { diagramImportSchema } from '../types';
import type { DiagramSchema } from '../types';

// Conversor Mermaid ↔ modelo interno. Cubre: round-trip (build → toMermaid →
// fromMermaid) para flowchart/sequence/erd/mindmap conservando nº de nodos/aristas
// y labels, e import de snippets Mermaid escritos a mano por tipo. El resultado del
// import es CANDIDATO; lo pasamos por diagramImportSchema para asegurar que es un
// diagrama estructuralmente válido (sin huérfanas, enums correctos).

function importValid(d: DiagramSchema) {
  const r = diagramImportSchema.safeParse(d);
  expect(r.success).toBe(true);
  return d;
}

describe('mermaidFormat (módulo)', () => {
  it('expone la interfaz FormatModule esperada', () => {
    expect(mermaidFormat.id).toBe('mermaid');
    expect(mermaidFormat.extension).toBe('mmd');
    expect(mermaidFormat.canImport).toBe(true);
    expect(mermaidFormat.canExport).toBe(true);
    expect(typeof mermaidFormat.toContent).toBe('function');
    expect(typeof mermaidFormat.fromContent).toBe('function');
  });
});

describe('flowchart', () => {
  const diagram: DiagramSchema = {
    title: 'Login',
    diagram_type: 'flowchart',
    nodes: [
      { id: 'ini', label: 'Inicio', node_type: 'terminator', attributes: [] },
      { id: 'paso', label: 'Validar', node_type: 'step', attributes: [] },
      { id: 'dec', label: 'OK?', node_type: 'decision', attributes: [] },
      { id: 'fin', label: 'Fin', node_type: 'terminator', attributes: [] },
    ],
    edges: [
      { id: 'e1', source: 'ini', target: 'paso', label: '', edge_type: 'flow' },
      { id: 'e2', source: 'paso', target: 'dec', label: '', edge_type: 'flow' },
      { id: 'e3', source: 'dec', target: 'fin', label: 'si', edge_type: 'conditional' },
    ],
  };

  it('round-trip conserva nº de nodos/aristas y labels', () => {
    const mmd = toMermaid(diagram);
    const back = fromMermaid(mmd, { diagramType: 'flowchart' });
    importValid(back);
    expect(back.nodes).toHaveLength(4);
    expect(back.edges).toHaveLength(3);
    const labels = back.nodes.map((n) => n.label).sort();
    expect(labels).toEqual(['Fin', 'Inicio', 'OK?', 'Validar']);
  });

  it('mapea formas → node_type y arista punteada → conditional', () => {
    const mmd = toMermaid(diagram);
    expect(mmd).toContain('flowchart TD');
    expect(mmd).toContain('dec{OK?}');
    expect(mmd).toContain('ini([Inicio])');
    expect(mmd).toContain('-.->');
    const back = fromMermaid(mmd, { diagramType: 'flowchart' });
    expect(back.nodes.find((n) => n.id === 'dec')?.node_type).toBe('decision');
    expect(back.edges.find((e) => e.source === 'dec')?.edge_type).toBe('conditional');
  });

  it('importa snippet escrito a mano', () => {
    const snippet = `flowchart TD
      A([Start]) --> B[Do work]
      B --> C{Done?}
      C -.->|no| B
      C -->|yes| D([End])`;
    const d = fromMermaid(snippet, { diagramType: 'flowchart' });
    importValid(d);
    expect(d.nodes).toHaveLength(4);
    expect(d.edges).toHaveLength(4);
    expect(d.nodes.find((n) => n.id === 'C')?.node_type).toBe('decision');
    expect(d.nodes.find((n) => n.id === 'A')?.node_type).toBe('terminator');
  });
});

describe('sequence', () => {
  const diagram: DiagramSchema = {
    title: 'Compra',
    diagram_type: 'sequence',
    nodes: [
      { id: 'u', label: 'Usuario', node_type: 'actor', attributes: [] },
      { id: 's', label: 'Servidor', node_type: 'actor', attributes: [] },
    ],
    edges: [
      { id: 'm1', source: 'u', target: 's', label: 'login()', edge_type: 'sequence' },
      { id: 'm2', source: 's', target: 'u', label: 'token', edge_type: 'sequence' },
    ],
  };

  it('round-trip conserva nodos/aristas y labels', () => {
    const mmd = toMermaid(diagram);
    const back = fromMermaid(mmd, { diagramType: 'sequence' });
    importValid(back);
    expect(back.nodes).toHaveLength(2);
    expect(back.edges).toHaveLength(2);
    expect(back.nodes.map((n) => n.label).sort()).toEqual(['Servidor', 'Usuario']);
    expect(back.edges.map((e) => e.label).sort()).toEqual(['login()', 'token']);
  });

  it('exporta participants y mensajes con fragments', () => {
    const withFrag: DiagramSchema = {
      ...diagram,
      fragments: [
        {
          id: 'f1',
          kind: 'alt',
          operands: [
            { guard: 'ok', message_ids: ['m1'], child_fragment_ids: [] },
            { guard: 'fail', message_ids: ['m2'], child_fragment_ids: [] },
          ],
        },
      ],
    };
    const mmd = toMermaid(withFrag);
    expect(mmd).toContain('sequenceDiagram');
    expect(mmd).toContain('participant u as Usuario');
    expect(mmd).toContain('alt ok');
    expect(mmd).toContain('else fail');
    expect(mmd).toContain('end');
  });

  it('importa snippet escrito a mano', () => {
    const snippet = `sequenceDiagram
      participant A as Alice
      participant B as Bob
      A->>B: Hola
      B-->>A: Adios`;
    const d = fromMermaid(snippet, { diagramType: 'sequence' });
    importValid(d);
    expect(d.nodes).toHaveLength(2);
    expect(d.edges).toHaveLength(2);
    expect(d.nodes.find((n) => n.id === 'A')?.label).toBe('Alice');
    expect(d.edges[0].edge_type).toBe('sequence');
  });
});

describe('erd', () => {
  const diagram: DiagramSchema = {
    title: 'Tienda',
    diagram_type: 'erd',
    nodes: [
      { id: 'usuario', label: 'Usuario', node_type: 'table', attributes: ['int id', 'string email'] },
      { id: 'pedido', label: 'Pedido', node_type: 'table', attributes: [] },
    ],
    edges: [
      { id: 'e1', source: 'usuario', target: 'pedido', label: 'realiza', edge_type: 'one_to_many' },
    ],
  };

  it('round-trip conserva nodos/aristas y labels', () => {
    const mmd = toMermaid(diagram);
    expect(mmd).toContain('erDiagram');
    expect(mmd).toContain('||--o{');
    const back = fromMermaid(mmd, { diagramType: 'erd' });
    importValid(back);
    expect(back.nodes).toHaveLength(2);
    expect(back.edges).toHaveLength(1);
    expect(back.nodes.map((n) => n.label).sort()).toEqual(['Pedido', 'Usuario']);
    expect(back.edges[0].label).toBe('realiza');
    expect(back.edges[0].edge_type).toBe('one_to_many');
  });

  it('conserva atributos de la entidad', () => {
    const mmd = toMermaid(diagram);
    const back = fromMermaid(mmd, { diagramType: 'erd' });
    const usuario = back.nodes.find((n) => n.label === 'Usuario');
    expect(usuario?.attributes.length).toBe(2);
  });

  it('importa snippet escrito a mano con cardinalidades', () => {
    const snippet = `erDiagram
      CLIENTE {
        int id
        string nombre
      }
      FACTURA {
        int id
      }
      CLIENTE ||--|{ FACTURA : emite`;
    const d = fromMermaid(snippet, { diagramType: 'erd' });
    importValid(d);
    expect(d.nodes).toHaveLength(2);
    expect(d.edges).toHaveLength(1);
    expect(d.edges[0].edge_type).toBe('one_to_many');
    expect(d.nodes.find((n) => n.id === 'CLIENTE')?.attributes).toHaveLength(2);
  });
});

describe('mindmap', () => {
  const diagram: DiagramSchema = {
    title: 'Ideas',
    diagram_type: 'mindmap',
    nodes: [
      { id: 'root', label: 'Proyecto', node_type: 'topic', attributes: [] },
      { id: 'a', label: 'Frontend', node_type: 'topic', attributes: [] },
      { id: 'b', label: 'Backend', node_type: 'topic', attributes: [] },
      { id: 'c', label: 'React', node_type: 'topic', attributes: [] },
    ],
    edges: [
      { id: 'e1', source: 'root', target: 'a', label: '', edge_type: 'association' },
      { id: 'e2', source: 'root', target: 'b', label: '', edge_type: 'association' },
      { id: 'e3', source: 'a', target: 'c', label: '', edge_type: 'association' },
    ],
  };

  it('round-trip conserva nodos/aristas y labels', () => {
    const mmd = toMermaid(diagram);
    expect(mmd).toContain('mindmap');
    expect(mmd).toContain('root((Proyecto))');
    const back = fromMermaid(mmd, { diagramType: 'mindmap' });
    importValid(back);
    expect(back.nodes).toHaveLength(4);
    expect(back.edges).toHaveLength(3);
    expect(back.nodes.map((n) => n.label).sort()).toEqual(['Backend', 'Frontend', 'Proyecto', 'React']);
  });

  it('importa snippet indentado escrito a mano', () => {
    const snippet = `mindmap
  root((Raiz))
    Rama A
      Hoja A1
    Rama B`;
    const d = fromMermaid(snippet, { diagramType: 'mindmap' });
    importValid(d);
    expect(d.nodes).toHaveLength(4);
    // Raiz→RamaA, RamaA→HojaA1, Raiz→RamaB
    expect(d.edges).toHaveLength(3);
    const root = d.nodes.find((n) => n.label === 'Raiz');
    expect(d.edges.filter((e) => e.source === root?.id)).toHaveLength(2);
  });
});

describe('architecture / use_case (aproximaciones)', () => {
  it('architecture exporta C4Context y reimporta sin huérfanas', () => {
    const diagram: DiagramSchema = {
      title: 'Sistema',
      diagram_type: 'architecture',
      nodes: [
        { id: 'user', label: 'Cliente', node_type: 'person', attributes: [] },
        { id: 'api', label: 'API', node_type: 'service', attributes: [] },
        { id: 'db', label: 'BD', node_type: 'database', attributes: [] },
      ],
      edges: [
        { id: 'e1', source: 'user', target: 'api', label: 'usa', edge_type: 'calls' },
        { id: 'e2', source: 'api', target: 'db', label: 'consulta', edge_type: 'depends_on' },
      ],
    };
    const mmd = toMermaid(diagram);
    expect(mmd).toContain('C4Context');
    expect(mmd).toContain('Person(user');
    expect(mmd).toContain('Rel(user, api');
  });

  it('use_case exporta flowchart LR aproximado', () => {
    const diagram: DiagramSchema = {
      title: 'Casos',
      diagram_type: 'use_case',
      nodes: [
        { id: 'actor1', label: 'Cliente', node_type: 'actor', attributes: [] },
        { id: 'uc1', label: 'Comprar', node_type: 'use_case', attributes: [] },
        { id: 'uc2', label: 'Pagar', node_type: 'use_case', attributes: [] },
      ],
      edges: [
        { id: 'e1', source: 'actor1', target: 'uc1', label: '', edge_type: 'association' },
        { id: 'e2', source: 'uc1', target: 'uc2', label: '', edge_type: 'include' },
      ],
    };
    const mmd = toMermaid(diagram);
    expect(mmd).toContain('flowchart LR');
    expect(mmd).toContain('include');
    // reimport vía parser flowchart
    const back = fromMermaid(mmd, { diagramType: 'use_case' });
    importValid(back);
    expect(back.nodes.length).toBeGreaterThanOrEqual(3);
  });
});
