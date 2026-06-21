// Conversor Mermaid → modelo interno. Parsers escritos a mano (sin dependencias),
// uno por gramática. Despacha por opts.diagramType (lo eligió el usuario en el
// modal), NO por la cabecera del fichero: si la cabecera contradice, parsea según
// opts.diagramType de todas formas.
//
// fromMermaid NO valida: devuelve un DiagramSchema CANDIDATO. Quien llama corre
// diagramImportSchema. NO se inventan posiciones (las generan los layouts). Se
// garantiza integridad referencial: una arista a un id no declarado crea ese nodo
// implícito (igual que Mermaid).

import type {
  DiagramSchema,
  DiagramNode,
  DiagramEdge,
  DiagramType,
  NodeType,
  EdgeType,
} from '../../../../types';
import type { ImportOptions } from '../types';

// node_type por defecto de cada tipo de diagrama (para nodos implícitos / sin forma
// reconocible).
const DEFAULT_NODE_TYPE: Record<DiagramType, NodeType> = {
  erd: 'table',
  sequence: 'actor',
  flowchart: 'step',
  architecture: 'service',
  mindmap: 'topic',
  use_case: 'use_case',
};

// edge_type por defecto de cada tipo.
const DEFAULT_EDGE_TYPE: Record<DiagramType, EdgeType> = {
  erd: 'one_to_many',
  sequence: 'sequence',
  flowchart: 'flow',
  architecture: 'calls',
  mindmap: 'association',
  use_case: 'association',
};

// Builder común: acumula nodos (dedup por id) y aristas; crea nodos implícitos.
class SchemaBuilder {
  private nodes = new Map<string, DiagramNode>();
  private edges: DiagramEdge[] = [];
  private edgeSeq = 0;
  private readonly diagramType: DiagramType;
  constructor(diagramType: DiagramType) {
    this.diagramType = diagramType;
  }

  addNode(id: string, label: string, nodeType?: NodeType, attributes: string[] = []): void {
    const existing = this.nodes.get(id);
    if (existing) {
      // Una declaración explícita posterior mejora label/tipo de un implícito.
      if (label && (!existing.label || existing.label === existing.id)) existing.label = label;
      if (nodeType) existing.node_type = nodeType;
      if (attributes.length) existing.attributes = attributes;
      return;
    }
    this.nodes.set(id, {
      id,
      label: label || id,
      node_type: nodeType ?? DEFAULT_NODE_TYPE[this.diagramType],
      attributes,
    });
  }

  // Asegura que un id referenciado por una arista exista como nodo.
  ensureNode(id: string): void {
    if (!this.nodes.has(id)) this.addNode(id, id);
  }

  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  addEdge(source: string, target: string, label = '', edgeType?: EdgeType): void {
    this.ensureNode(source);
    this.ensureNode(target);
    this.edges.push({
      id: `e${++this.edgeSeq}`,
      source,
      target,
      label,
      edge_type: edgeType ?? DEFAULT_EDGE_TYPE[this.diagramType],
    });
  }

  build(title: string): DiagramSchema {
    return {
      title,
      diagram_type: this.diagramType,
      nodes: [...this.nodes.values()],
      edges: this.edges,
    };
  }
}

// Sanea un id Mermaid a un id interno seguro (alfanumérico/_).
function safeId(raw: string): string {
  const cleaned = raw.trim().replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'n';
}

// Limpia comillas/escapes de una etiqueta Mermaid.
function cleanLabel(raw: string): string {
  return raw.trim().replace(/^["']|["']$/g, '').replace(/&quot;/g, '"').trim();
}

// Quita la cabecera (flowchart TD, sequenceDiagram, %% comments) y devuelve líneas
// no vacías.
function contentLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/\t/g, '  ').replace(/%%.*$/, '').trimEnd())
    .filter((l) => l.trim().length > 0);
}

function isHeader(line: string): boolean {
  return /^\s*(flowchart|graph|sequenceDiagram|erDiagram|mindmap|C4Context|classDiagram|stateDiagram)/.test(line);
}

// ----- flowchart parser ----------------------------------------------------

// Reconoce declaraciones de nodo por forma e identifica aristas. Maneja líneas con
// arista + nodos inline, p. ej. `A[Inicio] --> B{Decide}`.
function nodeTypeFromShape(open: string): NodeType {
  if (open === '{') return 'decision';
  if (open === '([') return 'terminator';
  if (open === '((') return 'terminator';
  return 'step';
}

// Extrae las declaraciones de nodo (id + forma + label) de un fragmento y devuelve
// el id "pelado". Registra el nodo en el builder si trae forma.
function parseNodeToken(token: string, b: SchemaBuilder): string {
  const t = token.trim();
  // id([label]) | id[label] | id{label} | id((label)) | id(label)
  const m = t.match(/^([A-Za-z0-9_]+)\s*(\(\(|\(\[|\{|\[|\()(.*?)(\)\)|\]\)|\}|\]|\))\s*$/);
  if (m) {
    const id = safeId(m[1]);
    const label = cleanLabel(m[3]);
    b.addNode(id, label, nodeTypeFromShape(m[2]));
    return id;
  }
  // id pelado
  const id = safeId(t);
  b.ensureNode(id);
  return id;
}

const FLOW_ARROW = /\s(-\.->|-->|---|==>|-\.-)\s*(?:\|([^|]*)\|)?\s*/;

function parseFlowchart(text: string, diagramType: DiagramType): DiagramSchema {
  const b = new SchemaBuilder(diagramType);
  for (const line of contentLines(text)) {
    if (isHeader(line)) continue;
    const trimmed = line.trim();
    if (/^(subgraph|end|direction|classDef|class|style|click)\b/.test(trimmed)) continue;

    const arrowMatch = trimmed.match(FLOW_ARROW);
    if (arrowMatch && arrowMatch.index !== undefined) {
      const left = trimmed.slice(0, arrowMatch.index);
      const right = trimmed.slice(arrowMatch.index + arrowMatch[0].length);
      const arrow = arrowMatch[1];
      const label = arrowMatch[2] ? cleanLabel(arrowMatch[2]) : '';
      const src = parseNodeToken(left, b);
      const tgt = parseNodeToken(right, b);
      const dotted = arrow === '-.->' || arrow === '-.-';
      const edgeType: EdgeType = dotted ? 'conditional' : DEFAULT_EDGE_TYPE[diagramType];
      b.addEdge(src, tgt, label, edgeType);
    } else {
      // Declaración de nodo suelta.
      parseNodeToken(trimmed, b);
    }
  }
  return b.build('Diagrama importado');
}

// ----- sequence parser -----------------------------------------------------

function parseSequence(text: string, diagramType: DiagramType): DiagramSchema {
  const b = new SchemaBuilder(diagramType);
  for (const line of contentLines(text)) {
    if (isHeader(line)) continue;
    const trimmed = line.trim();

    // participant id as Label  |  participant Label  |  actor id as Label
    const partMatch = trimmed.match(/^(?:participant|actor)\s+([A-Za-z0-9_]+)(?:\s+as\s+(.+))?$/);
    if (partMatch) {
      const id = safeId(partMatch[1]);
      b.addNode(id, partMatch[2] ? cleanLabel(partMatch[2]) : id, 'actor');
      continue;
    }

    // Bloques de fragmento: se ignoran a nivel de mensajes (no reconstruimos
    // fragments en el import; el contrato lo permite como opcional). Los mensajes
    // internos sí se capturan abajo.
    if (/^(alt|opt|loop|par|else|end|note|activate|deactivate|rect)\b/.test(trimmed)) continue;

    // src ->> tgt : label   (acepta ->, -->>, ->>, --x, -x, etc.)
    const msgMatch = trimmed.match(/^([A-Za-z0-9_]+)\s*(?:-->>|->>|-->|->|--x|-x|--\)|-\))\s*([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (msgMatch) {
      const src = safeId(msgMatch[1]);
      const tgt = safeId(msgMatch[2]);
      b.addNode(src, src, 'actor');
      b.addNode(tgt, tgt, 'actor');
      b.addEdge(src, tgt, cleanLabel(msgMatch[3]), 'sequence');
    }
  }
  return b.build('Diagrama importado');
}

// ----- erd parser ----------------------------------------------------------

const ERD_REL: Record<string, EdgeType> = {
  '||--||': 'one_to_one',
  '||--o{': 'one_to_many',
  '||--|{': 'one_to_many',
  '}o--o{': 'many_to_many',
  '}o--||': 'one_to_many',
  '}|--|{': 'many_to_many',
};

function parseErd(text: string, diagramType: DiagramType): DiagramSchema {
  const b = new SchemaBuilder(diagramType);
  const lines = contentLines(text);
  let currentEntity: string | null = null;
  let attrs: string[] = [];

  const flushEntity = () => {
    if (currentEntity) b.addNode(currentEntity, currentEntity, 'table', attrs);
    currentEntity = null;
    attrs = [];
  };

  for (const line of lines) {
    if (isHeader(line)) continue;
    const trimmed = line.trim();

    // Bloque de atributos: ENT {
    const blockOpen = trimmed.match(/^([A-Za-z0-9_]+)\s*\{$/);
    if (blockOpen) {
      flushEntity();
      currentEntity = safeId(blockOpen[1]);
      continue;
    }
    if (trimmed === '}') {
      flushEntity();
      continue;
    }
    if (currentEntity) {
      // fila de atributo: TYPE name  (o más tokens / claves PK/FK)
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) attrs.push(`${parts[0]} ${parts[1]}`);
      else if (parts.length === 1) attrs.push(parts[0]);
      continue;
    }

    // Relación: ENT1 <card> ENT2 : label
    const relMatch = trimmed.match(/^([A-Za-z0-9_]+)\s+(\S+)\s+([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (relMatch) {
      const a = safeId(relMatch[1]);
      const card = relMatch[2];
      const c = safeId(relMatch[3]);
      const label = cleanLabel(relMatch[4]);
      b.addNode(a, a, 'table');
      b.addNode(c, c, 'table');
      b.addEdge(a, c, label, ERD_REL[card] ?? 'one_to_many');
    }
  }
  flushEntity();
  return b.build('Diagrama importado');
}

// ----- mindmap parser ------------------------------------------------------

// El mapa mental Mermaid codifica la jerarquía con la INDENTACIÓN. Mantenemos una
// pila (indent → id) y colgamos cada línea de su ancestro más cercano con menos
// indentación.
function parseMindmapLabel(raw: string): { id: string; label: string } {
  const t = raw.trim();
  // root((Label)) | id((Label)) | id[Label] | id(Label) | Label
  const shaped = t.match(/^([A-Za-z0-9_]*)\s*(\(\(|\[|\()(.*?)(\)\)|\]|\))\s*$/);
  if (shaped) {
    const label = cleanLabel(shaped[3]);
    const id = shaped[1] ? safeId(shaped[1]) : safeId(label);
    return { id, label };
  }
  return { id: safeId(t), label: t };
}

function parseMindmap(text: string, diagramType: DiagramType): DiagramSchema {
  const b = new SchemaBuilder(diagramType);
  const rawLines = text.split('\n').filter((l) => l.trim().length > 0 && !/^\s*%%/.test(l));
  // Pila de [indent, id].
  const stack: { indent: number; id: string }[] = [];
  let counter = 0;

  for (const raw of rawLines) {
    if (isHeader(raw)) continue;
    const indent = raw.length - raw.replace(/^\s*/, '').length;
    let { id, label } = parseMindmapLabel(raw);
    if (!id) id = `n${++counter}`;
    // Evita colisión de ids (dos ramas con el mismo label).
    let uid = id;
    let n = 1;
    while (b.hasNode(uid)) uid = `${id}_${++n}`;
    b.addNode(uid, label, 'topic');

    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (stack.length) b.addEdge(stack[stack.length - 1].id, uid, '', 'association');
    stack.push({ indent, id: uid });
  }
  return b.build('Diagrama importado');
}

// ----- dispatch ------------------------------------------------------------

export function fromMermaid(text: string, opts: ImportOptions): DiagramSchema {
  const { diagramType } = opts;
  switch (diagramType) {
    case 'sequence':
      return parseSequence(text, diagramType);
    case 'erd':
      return parseErd(text, diagramType);
    case 'mindmap':
      return parseMindmap(text, diagramType);
    case 'flowchart':
    case 'architecture':
    case 'use_case':
    default:
      // architecture/use_case reutilizan el parser de flowchart (su export aproxima
      // con flowchart/C4; un fichero flowchart-like se parsea razonablemente y los
      // node_type caen al DEFAULT del tipo destino).
      return parseFlowchart(text, diagramType);
  }
}
