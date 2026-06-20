// Import desde draw.io (mxGraph XML) al modelo interno.
//
// HEURÍSTICO Y CON PÉRDIDA (por eso el formato es importExperimental): un .drawio
// arbitrario no lleva nuestra semántica (node_type/edge_type, attributes), así que
// hay que reconstruirla a partir de `style` y de los data-* que NUESTRO export deja
// (round-trip fiel). Cuando importamos un .drawio ajeno, esos data-* no están y
// caemos a la heurística de formas, acotada SIEMPRE al conjunto válido del
// diagram_type que el usuario eligió en el modal (opts.diagramType).
//
// Esto NO valida: devuelve un DiagramSchema CANDIDATO. El modal lo pasa por
// diagramImportSchema (forma + enums + huérfanas). Aun así, aquí ya garantizamos
// integridad referencial básica (descartamos aristas cuyo source/target no sea un
// vértice) para no producir basura.

import type { DiagramSchema, DiagramNode, DiagramEdge, NodeType, EdgeType } from '../../../../types';
import type { ImportOptions } from '../types';
import { DIAGRAM_NODE_TYPES } from '../../diagramNodeTypes';
import { DIAGRAM_EDGE_TYPES } from '../../../../types';

// node_types válidos para un diagram_type (mismo orden que la paleta). El primero
// es el fallback cuando no reconocemos la forma.
function validNodeTypes(diagramType: DiagramSchema['diagram_type']): NodeType[] {
  return (DIAGRAM_NODE_TYPES[diagramType] ?? []).map((info) => info.type);
}

function validEdgeTypes(diagramType: DiagramSchema['diagram_type']): EdgeType[] {
  return (DIAGRAM_EDGE_TYPES[diagramType] ?? []).map((info) => info.value);
}

// Mapeo forma (style mxGraph) → node_type "deseado", antes de acotar al tipo.
// Devuelve el node_type sugerido o null si la forma no es reconocible.
function nodeTypeFromStyle(style: string): NodeType | null {
  const s = style.toLowerCase();
  if (s.includes('rhombus')) return 'decision';
  if (s.includes('cylinder')) return 'database';
  if (s.includes('umlactor') || s.includes('mxgraph.basic.user') || s.includes('shape=actor')) {
    return 'actor';
  }
  if (s.includes('ellipse')) return 'use_case';
  if (s.includes('process')) return 'queue';
  if (s.includes('rounded=1')) return 'terminator';
  return null;
}

// Resuelve el node_type final: 1) data-node-type de nuestro export si es válido para
// el tipo; 2) heurística por forma si cae dentro del conjunto válido; 3) fallback al
// primer node_type válido del diagram_type.
function resolveNodeType(
  explicit: string | null,
  style: string,
  valid: NodeType[],
): NodeType {
  const validSet = new Set<string>(valid);
  if (explicit && validSet.has(explicit)) return explicit as NodeType;

  const guessed = nodeTypeFromStyle(style);
  if (guessed && validSet.has(guessed)) return guessed;

  // 'person' y 'actor' son intercambiables según el tipo (actor→sequence/use_case,
  // person→architecture): si la heurística dio 'actor' pero el tipo solo admite
  // 'person', reconvertimos.
  if (guessed === 'actor' && validSet.has('person')) return 'person';
  if (guessed === 'decision' && validSet.has('gateway')) return 'gateway';

  return valid[0] ?? 'step';
}

// Resuelve el edge_type final: data-edge-type de nuestro export si es válido;
// si no, 'conditional' cuando el trazo es discontinuo y el tipo lo admite; si no,
// el primer edge_type válido del diagram_type.
function resolveEdgeType(
  explicit: string | null,
  style: string,
  valid: EdgeType[],
): EdgeType | undefined {
  const validSet = new Set<string>(valid);
  if (explicit && validSet.has(explicit)) return explicit as EdgeType;

  if (style.toLowerCase().includes('dashed=1') && validSet.has('conditional')) {
    return 'conditional';
  }
  return valid[0];
}

// El value de draw.io puede traer marcado HTML (cuando html=1) y entidades; lo
// limpiamos para quedarnos con texto plano. Las líneas las separamos por <br>, \n
// o &#10; → la primera es el label; el resto, candidatos a attributes (solo se usan
// si no vienen ya en data-attrs).
function decodeValue(raw: string): { label: string; lines: string[] } {
  const normalized = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '') // quita cualquier otra etiqueta HTML
    .replace(/&#10;/g, '\n')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
  const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean);
  return { label: lines[0] ?? '', lines: lines.slice(1) };
}

// attributes: los de nuestro data-attrs (fieles) o, en su defecto, las líneas extra
// del value. data-attrs ya viene des-escapado por el parser DOM salvo el \n que
// metimos como literal en el atributo.
function decodeAttrs(dataAttrs: string | null, extraLines: string[]): string[] {
  if (dataAttrs != null) {
    return dataAttrs.split('\n').map((l) => l.trim()).filter(Boolean);
  }
  return extraLines;
}

function parseNumber(v: string | null): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function fromDrawio(text: string, opts: ImportOptions): DiagramSchema {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'application/xml');

  // DOMParser no lanza en XML mal formado: mete un <parsererror>. Lo tratamos como
  // entrada corrupta (el modal captura el throw y muestra el toast).
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('El XML de draw.io está corrupto o mal formado.');
  }

  const model = doc.getElementsByTagName('mxGraphModel')[0];
  const title = model?.getAttribute('data-title') ?? 'Diagrama importado';

  const validN = validNodeTypes(opts.diagramType);
  const validE = validEdgeTypes(opts.diagramType);

  const cells = Array.from(doc.getElementsByTagName('mxCell'));

  const nodes: DiagramNode[] = [];
  const nodeIds = new Set<string>();

  // Primera pasada: vértices.
  for (const cell of cells) {
    if (cell.getAttribute('vertex') !== '1') continue;
    const id = cell.getAttribute('id');
    if (!id) continue;

    const style = cell.getAttribute('style') ?? '';
    const { label, lines } = decodeValue(cell.getAttribute('value') ?? '');
    const nodeType = resolveNodeType(cell.getAttribute('data-node-type'), style, validN);
    const attributes = decodeAttrs(cell.getAttribute('data-attrs'), lines);

    const geom = cell.getElementsByTagName('mxGeometry')[0];
    const x = parseNumber(geom?.getAttribute('x') ?? null);
    const y = parseNumber(geom?.getAttribute('y') ?? null);

    const node: DiagramNode = {
      // Un vértice sin `value` es un nodo sin nombre: label vacío (NO el id de la
      // celda, que es ruido como `SpgqVLihlZ-_wyZ7A0N_-4`). El schema admite ''.
      id,
      label,
      node_type: nodeType,
      attributes,
    };
    if (x !== undefined && y !== undefined) node.position = { x, y };

    nodes.push(node);
    nodeIds.add(id);
  }

  // Segunda pasada: aristas. Descartamos las que no tengan source/target válidos
  // entre los vértices (integridad referencial — evita huérfanas).
  const edges: DiagramEdge[] = [];
  for (const cell of cells) {
    if (cell.getAttribute('edge') !== '1') continue;
    const id = cell.getAttribute('id');
    const source = cell.getAttribute('source');
    const target = cell.getAttribute('target');
    if (!id || !source || !target) continue;
    if (!nodeIds.has(source) || !nodeIds.has(target)) continue;

    const style = cell.getAttribute('style') ?? '';
    const { label } = decodeValue(cell.getAttribute('value') ?? '');
    const edgeType = resolveEdgeType(cell.getAttribute('data-edge-type'), style, validE);

    const edge: DiagramEdge = { id, source, target, label };
    if (edgeType) edge.edge_type = edgeType;
    edges.push(edge);
  }

  return {
    title,
    diagram_type: opts.diagramType,
    nodes,
    edges,
  };
}
