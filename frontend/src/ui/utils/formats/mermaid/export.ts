// Conversor modelo interno → Mermaid. Despacha por diagram.diagram_type.
//
// Mermaid es un formato de TEXTO con pérdida: solo flowchart/sequence/erd/mindmap
// tienen una gramática nativa que casa con nuestros tipos. architecture y use_case
// no existen como tales en Mermaid, así que se APROXIMAN (ver comentarios en sus
// funciones). Las posiciones del canvas no se serializan: Mermaid no las soporta.

import type {
  DiagramSchema,
  DiagramNode,
  DiagramEdge,
  EdgeType,
} from '../../../../types';

// Sanea un texto libre para usarlo como identificador Mermaid (entidades erd,
// participantes…): solo alfanumérico y _, sin empezar por dígito.
function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!cleaned) return 'n';
  return /^[0-9]/.test(cleaned) ? `n_${cleaned}` : cleaned;
}

// Escapa comillas dobles dentro de etiquetas entre comillas (C4, etc.).
function escQuotes(s: string): string {
  return s.replace(/"/g, '&quot;');
}

// ----- flowchart -----------------------------------------------------------

function nodeShapeFlow(node: DiagramNode): string {
  const label = node.label || node.id;
  switch (node.node_type) {
    case 'terminator':
      return `${node.id}([${label}])`;
    case 'decision':
      return `${node.id}{${label}}`;
    case 'step':
    default:
      return `${node.id}[${label}]`;
  }
}

function edgeFlow(edge: DiagramEdge): string {
  const arrow = edge.edge_type === 'conditional' ? '-.->' : '-->';
  const lbl = edge.label ? `|${edge.label}|` : '';
  return `${edge.source} ${arrow}${lbl} ${edge.target}`;
}

function toFlowchart(diagram: DiagramSchema): string {
  const lines = ['flowchart TD'];
  for (const node of diagram.nodes) lines.push(`  ${nodeShapeFlow(node)}`);
  for (const edge of diagram.edges) lines.push(`  ${edgeFlow(edge)}`);
  return lines.join('\n');
}

// ----- erd -----------------------------------------------------------------

const ERD_CARDINALITY: Record<string, string> = {
  one_to_one: '||--||',
  one_to_many: '||--o{',
  many_to_many: '}o--o{',
};

// Un attribute interno es texto libre ("id PK", "email", "string nombre"). Mermaid
// erd quiere "TYPE name": si el attribute ya trae dos tokens lo respetamos; si trae
// uno solo, le ponemos el tipo genérico `string`.
function erdAttrRow(attr: string): string {
  const parts = attr.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0]} ${parts.slice(1).join('_')}`;
  return `string ${parts[0] || 'campo'}`;
}

function toErd(diagram: DiagramSchema): string {
  const lines = ['erDiagram'];
  // Mapa id interno → nombre de entidad saneado (estable).
  const entName = new Map<string, string>();
  for (const node of diagram.nodes) {
    entName.set(node.id, sanitizeId(node.label || node.id));
  }
  for (const node of diagram.nodes) {
    const name = entName.get(node.id)!;
    if (node.attributes.length === 0) {
      lines.push(`  ${name} {`, `  }`);
    } else {
      lines.push(`  ${name} {`);
      for (const attr of node.attributes) lines.push(`    ${erdAttrRow(attr)}`);
      lines.push(`  }`);
    }
  }
  for (const edge of diagram.edges) {
    const a = entName.get(edge.source);
    const b = entName.get(edge.target);
    if (!a || !b) continue;
    const card = ERD_CARDINALITY[edge.edge_type ?? 'one_to_many'] ?? '||--o{';
    const lbl = edge.label || 'rel';
    lines.push(`  ${a} ${card} ${b} : ${lbl}`);
  }
  return lines.join('\n');
}

// ----- sequence ------------------------------------------------------------

function toSequence(diagram: DiagramSchema): string {
  const lines = ['sequenceDiagram'];
  for (const node of diagram.nodes) {
    lines.push(`  participant ${node.id} as ${node.label || node.id}`);
  }

  const edgeById = new Map(diagram.edges.map((e) => [e.id, e]));
  const fragments = diagram.fragments ?? [];
  const fragById = new Map(fragments.map((f) => [f.id, f]));
  // message_ids que están envueltos por algún fragmento: no se emiten sueltos.
  const wrapped = new Set<string>();
  for (const f of fragments) {
    for (const op of f.operands) for (const mid of op.message_ids) wrapped.add(mid);
  }
  // Fragmentos hijos (anidados por referencia): no se emiten en el nivel raíz.
  const childFragIds = new Set<string>();
  for (const f of fragments) {
    for (const op of f.operands) for (const cid of op.child_fragment_ids) childFragIds.add(cid);
  }

  const emitMessage = (edge: DiagramEdge, indent: string) => {
    lines.push(`${indent}${edge.source}->>${edge.target}: ${edge.label}`);
  };

  const emitFragment = (fragId: string, indent: string) => {
    const frag = fragById.get(fragId);
    if (!frag) return;
    const ops = frag.operands;
    ops.forEach((op, i) => {
      const guard = op.guard || '';
      if (i === 0) {
        lines.push(`${indent}${frag.kind} ${guard}`.trimEnd());
      } else {
        lines.push(`${indent}else ${guard}`.trimEnd());
      }
      const inner = indent + '  ';
      for (const mid of op.message_ids) {
        const e = edgeById.get(mid);
        if (e) emitMessage(e, inner);
      }
      for (const cid of op.child_fragment_ids) emitFragment(cid, inner);
    });
    lines.push(`${indent}end`);
  };

  // Recorre los edges en orden; al toparse con el primer message de un fragmento
  // raíz, emite el bloque completo en su sitio.
  const emittedFrag = new Set<string>();
  const fragForMessage = (mid: string): string | undefined => {
    for (const f of fragments) {
      if (childFragIds.has(f.id)) continue;
      for (const op of f.operands) if (op.message_ids.includes(mid)) return f.id;
    }
    return undefined;
  };

  for (const edge of diagram.edges) {
    if (wrapped.has(edge.id)) {
      const fid = fragForMessage(edge.id);
      if (fid && !emittedFrag.has(fid)) {
        emittedFrag.add(fid);
        emitFragment(fid, '  ');
      }
      continue;
    }
    emitMessage(edge, '  ');
  }
  return lines.join('\n');
}

// ----- mindmap -------------------------------------------------------------

function toMindmap(diagram: DiagramSchema): string {
  const lines = ['mindmap'];
  if (diagram.nodes.length === 0) return lines.join('\n');

  // Raíz = nodo sin aristas entrantes; si no hay, el primero.
  const targets = new Set(diagram.edges.map((e) => e.target));
  const root = diagram.nodes.find((n) => !targets.has(n.id)) ?? diagram.nodes[0];

  // Aristas padre→hijo.
  const children = new Map<string, string[]>();
  for (const e of diagram.edges) {
    if (!children.has(e.source)) children.set(e.source, []);
    children.get(e.source)!.push(e.target);
  }
  const nodeById = new Map(diagram.nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();

  const walk = (id: string, depth: number) => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = nodeById.get(id);
    if (!node) return;
    const indent = '  '.repeat(depth + 1);
    const label = node.label || node.id;
    lines.push(depth === 0 ? `${indent}root((${label}))` : `${indent}${label}`);
    for (const childId of children.get(id) ?? []) walk(childId, depth + 1);
  };

  walk(root.id, 0);
  // Nodos huérfanos no alcanzados desde la raíz: cuélgalos del root.
  for (const node of diagram.nodes) {
    if (!visited.has(node.id)) walk(node.id, 1);
  }
  return lines.join('\n');
}

// ----- architecture --------------------------------------------------------

// Aproximación con C4Context: Mermaid no tiene un diagrama de arquitectura de cajas
// genérico, pero C4 sí modela Person/System/Container/Component y relaciones Rel().
// Mapeo: person→Person, system→System, container→Container, component→Component;
// service/database/queue/gateway no tienen primitiva C4 propia → System genérico
// (con pérdida del subtipo). Las aristas se vuelcan como Rel(a,b,"label").
const C4_KIND: Record<string, string> = {
  person: 'Person',
  system: 'System',
  container: 'Container',
  component: 'Component',
};

function toArchitecture(diagram: DiagramSchema): string {
  const lines = ['C4Context', '  title Arquitectura'];
  for (const node of diagram.nodes) {
    const kind = C4_KIND[node.node_type] ?? 'System';
    const label = escQuotes(node.label || node.id);
    lines.push(`  ${kind}(${node.id}, "${label}")`);
  }
  for (const edge of diagram.edges) {
    const lbl = escQuotes(edge.label || '');
    lines.push(`  Rel(${edge.source}, ${edge.target}, "${lbl}")`);
  }
  return lines.join('\n');
}

// ----- use_case ------------------------------------------------------------

// Aproximación con flowchart LR: Mermaid no tiene casos de uso. Actores como
// estadio ([...]), casos de uso redondeados ((...)) no, mejor (...) (round), system
// como subgraph. association `---`, include/extend punteadas con etiqueta, inherits
// `-->`. Con pérdida de la semántica UML estricta (estereotipos como texto).
function useCaseEdgeLine(edge: DiagramEdge): string {
  const t: EdgeType | undefined = edge.edge_type;
  if (t === 'include') return `${edge.source} -.->|include| ${edge.target}`;
  if (t === 'extend') return `${edge.source} -.->|extend| ${edge.target}`;
  if (t === 'inherits') return `${edge.source} --> ${edge.target}`;
  // association (por defecto): línea sin flecha.
  const lbl = edge.label ? `|${edge.label}|` : '';
  return `${edge.source} ---${lbl} ${edge.target}`;
}

function toUseCase(diagram: DiagramSchema): string {
  const lines = ['flowchart LR'];
  const systems = diagram.nodes.filter((n) => n.node_type === 'system');
  const inSystem = new Set<string>();

  const nodeDecl = (node: DiagramNode): string => {
    const label = node.label || node.id;
    if (node.node_type === 'actor') return `${node.id}([${label}])`;
    if (node.node_type === 'use_case') return `${node.id}(${label})`;
    return `${node.id}[${label}]`;
  };

  // Si hay sistemas, los casos de uso van dentro de un subgraph por sistema.
  if (systems.length > 0) {
    for (const sys of systems) {
      lines.push(`  subgraph ${sys.id}[${sys.label || sys.id}]`);
      // Heurística: casos de uso "contenidos" = todos los use_case (sin info de
      // contención en el modelo, los metemos en el primer subgraph).
      if (sys === systems[0]) {
        for (const node of diagram.nodes) {
          if (node.node_type === 'use_case') {
            lines.push(`    ${nodeDecl(node)}`);
            inSystem.add(node.id);
          }
        }
      }
      lines.push('  end');
    }
  }
  for (const node of diagram.nodes) {
    if (node.node_type === 'system') continue;
    if (inSystem.has(node.id)) continue;
    lines.push(`  ${nodeDecl(node)}`);
  }
  for (const edge of diagram.edges) lines.push(`  ${useCaseEdgeLine(edge)}`);
  return lines.join('\n');
}

// ----- dispatch ------------------------------------------------------------

export function toMermaid(diagram: DiagramSchema): string {
  switch (diagram.diagram_type) {
    case 'flowchart':
      return toFlowchart(diagram);
    case 'erd':
      return toErd(diagram);
    case 'sequence':
      return toSequence(diagram);
    case 'mindmap':
      return toMindmap(diagram);
    case 'architecture':
      return toArchitecture(diagram);
    case 'use_case':
      return toUseCase(diagram);
    default:
      return toFlowchart(diagram);
  }
}
