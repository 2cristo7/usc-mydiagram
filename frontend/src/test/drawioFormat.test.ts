import { describe, test, expect } from 'vitest';
import { toDrawio } from '../ui/utils/formats/drawio/export';
import { fromDrawio } from '../ui/utils/formats/drawio/import';
import { drawioFormat } from '../ui/utils/formats/drawio';
import { diagramImportSchema } from '../types';
import type { DiagramSchema } from '../types';

// El export draw.io es fiel gracias a los data-* propios; el import es heurístico
// (importExperimental). Estos tests fijan: (1) el round-trip export→import conserva
// nº de nodos/aristas, labels, posiciones y semántica; (2) el candidato pasa el
// schema de import (forma + enums + integridad); (3) importar un .drawio "ajeno"
// (sin data-*) cae a la heurística por forma; (4) integridad referencial.

const erd: DiagramSchema = {
  title: 'Tienda <online> & "co"',
  diagram_type: 'erd',
  nodes: [
    { id: 'usuario', label: 'Usuario', node_type: 'table', attributes: ['id PK', 'email'], position: { x: 40, y: 80 } },
    { id: 'pedido', label: 'Pedido', node_type: 'table', attributes: [], position: { x: 300, y: 80 } },
  ],
  edges: [
    { id: 'e1', source: 'usuario', target: 'pedido', label: 'realiza', edge_type: 'one_to_many' },
  ],
};

const flow: DiagramSchema = {
  title: 'Login',
  diagram_type: 'flowchart',
  nodes: [
    { id: 'ini', label: 'Inicio', node_type: 'terminator', attributes: [], position: { x: 0, y: 0 } },
    { id: 'check', label: '¿Válido?', node_type: 'decision', attributes: [], position: { x: 0, y: 120 } },
    { id: 'ok', label: 'Entrar', node_type: 'step', attributes: [], position: { x: 0, y: 240 } },
  ],
  edges: [
    { id: 'f1', source: 'ini', target: 'check', label: '', edge_type: 'flow' },
    { id: 'f2', source: 'check', target: 'ok', label: 'sí', edge_type: 'conditional' },
  ],
};

describe('toDrawio — serialización', () => {
  test('produce un mxGraphModel con las celdas raíz y un vertex/edge por elemento', () => {
    const xml = toDrawio(erd);
    expect(xml).toContain('<mxGraphModel');
    expect(xml).toContain('<mxCell id="0"/>');
    expect(xml).toContain('<mxCell id="1" parent="0"/>');
    expect(xml).toContain('vertex="1"');
    expect(xml).toContain('edge="1"');
    expect(xml).toContain('source="usuario"');
    expect(xml).toContain('target="pedido"');
  });

  test('escapa & < > " \' en el value y el title', () => {
    const xml = toDrawio(erd);
    expect(xml).toContain('data-title="Tienda &lt;online&gt; &amp; &quot;co&quot;"');
    // No debe quedar ningún & sin escapar (todos en forma de entidad).
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;|#10;)/);
  });

  test('mapea node_type a una forma reconocible de draw.io', () => {
    const xml = toDrawio(flow);
    expect(xml).toContain('rhombus'); // decision
    expect(xml).toMatch(/rounded=1/); // terminator
  });

  test('el XML es bien formado (parseable sin parsererror)', () => {
    const doc = new DOMParser().parseFromString(toDrawio(erd), 'application/xml');
    expect(doc.getElementsByTagName('parsererror').length).toBe(0);
  });
});

describe('round-trip export → import', () => {
  test('ERD: conserva nº de nodos/aristas, labels, tipos, atributos y posiciones', () => {
    const back = fromDrawio(toDrawio(erd), { diagramType: 'erd' });
    expect(back.nodes).toHaveLength(2);
    expect(back.edges).toHaveLength(1);
    expect(back.title).toBe(erd.title);

    const usuario = back.nodes.find((n) => n.id === 'usuario')!;
    expect(usuario.label).toBe('Usuario');
    expect(usuario.node_type).toBe('table');
    expect(usuario.attributes).toEqual(['id PK', 'email']);
    expect(usuario.position).toEqual({ x: 40, y: 80 });

    expect(back.edges[0].label).toBe('realiza');
    expect(back.edges[0].edge_type).toBe('one_to_many');
  });

  test('flowchart: conserva decision/terminator/step y el edge conditional', () => {
    const back = fromDrawio(toDrawio(flow), { diagramType: 'flowchart' });
    expect(back.nodes.find((n) => n.id === 'check')!.node_type).toBe('decision');
    expect(back.nodes.find((n) => n.id === 'ini')!.node_type).toBe('terminator');
    expect(back.nodes.find((n) => n.id === 'ok')!.node_type).toBe('step');
    expect(back.edges.find((e) => e.id === 'f2')!.edge_type).toBe('conditional');
  });

  test('el candidato del round-trip pasa diagramImportSchema', () => {
    const back = fromDrawio(toDrawio(erd), { diagramType: 'erd' });
    expect(diagramImportSchema.safeParse(back).success).toBe(true);
  });
});

describe('fromDrawio — import de un .drawio ajeno (sin data-*)', () => {
  const ajeno = `<mxGraphModel dx="800" dy="600" grid="1">
    <root>
      <mxCell id="0"/>
      <mxCell id="1" parent="0"/>
      <mxCell id="n1" value="¿Seguir?" style="rhombus;whiteSpace=wrap;html=1;" vertex="1" parent="1">
        <mxGeometry x="100" y="200" width="120" height="60" as="geometry"/>
      </mxCell>
      <mxCell id="n2" value="Fin" style="rounded=1;arcSize=50;whiteSpace=wrap;html=1;" vertex="1" parent="1">
        <mxGeometry x="100" y="320" width="120" height="60" as="geometry"/>
      </mxCell>
      <mxCell id="e1" value="no" style="edgeStyle=orthogonalEdgeStyle;dashed=1;" edge="1" parent="1" source="n1" target="n2">
        <mxGeometry relative="1" as="geometry"/>
      </mxCell>
    </root>
  </mxGraphModel>`;

  test('heurística por forma acotada al diagram_type elegido', () => {
    const d = fromDrawio(ajeno, { diagramType: 'flowchart' });
    expect(d.nodes.find((n) => n.id === 'n1')!.node_type).toBe('decision'); // rhombus
    expect(d.nodes.find((n) => n.id === 'n2')!.node_type).toBe('terminator'); // rounded=1
    expect(d.edges[0].edge_type).toBe('conditional'); // dashed=1
    expect(d.nodes.find((n) => n.id === 'n1')!.position).toEqual({ x: 100, y: 200 });
  });

  test('forma no reconocida cae al primer node_type válido del tipo', () => {
    const xml = `<mxGraphModel><root>
      <mxCell id="0"/><mxCell id="1" parent="0"/>
      <mxCell id="t" value="Cliente" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1">
        <mxGeometry x="0" y="0" width="120" height="60" as="geometry"/>
      </mxCell>
    </root></mxGraphModel>`;
    const d = fromDrawio(xml, { diagramType: 'erd' });
    expect(d.nodes[0].node_type).toBe('table'); // único válido en erd
  });
});

describe('fromDrawio — robustez', () => {
  test('descarta aristas con source/target inexistente (integridad referencial)', () => {
    const xml = `<mxGraphModel><root>
      <mxCell id="0"/><mxCell id="1" parent="0"/>
      <mxCell id="a" value="A" style="rounded=0;" vertex="1" parent="1">
        <mxGeometry x="0" y="0" width="120" height="60" as="geometry"/>
      </mxCell>
      <mxCell id="bad" value="x" style="" edge="1" parent="1" source="a" target="fantasma">
        <mxGeometry relative="1" as="geometry"/>
      </mxCell>
    </root></mxGraphModel>`;
    const d = fromDrawio(xml, { diagramType: 'flowchart' });
    expect(d.nodes).toHaveLength(1);
    expect(d.edges).toHaveLength(0);
    expect(diagramImportSchema.safeParse(d).success).toBe(true);
  });

  test('XML corrupto lanza', () => {
    expect(() => fromDrawio('<mxGraphModel><root', { diagramType: 'erd' })).toThrow();
  });
});

describe('drawioFormat — descriptor del módulo', () => {
  test('expone capacidades y flag experimental', () => {
    expect(drawioFormat.id).toBe('drawio');
    expect(drawioFormat.canImport).toBe(true);
    expect(drawioFormat.canExport).toBe(true);
    expect(drawioFormat.importExperimental).toBe(true);
    expect(drawioFormat.extension).toBe('drawio');
  });
});
