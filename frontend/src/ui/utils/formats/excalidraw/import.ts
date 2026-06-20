// Import fichero .excalidraw → DiagramSchema CANDIDATO (heurístico, con pérdida —
// por eso el FormatModule lo marca importExperimental). NO valida: devuelve el
// candidato y quien llama (el modal) lo pasa por diagramImportSchema (contrato y
// huérfanas). Aquí solo garantizamos integridad referencial básica para no producir
// flechas atadas a formas inexistentes.
//
// Heurística:
//  · Formas (rectangle/ellipse/diamond) no borradas → nodos. La label se toma del
//    text cuyo containerId apunta a la forma.
//  · node_type se acota con opts.diagramType (mapping.nodeTypeForShape).
//  · Flechas → aristas usando startBinding/endBinding como source/target. La label
//    de la arista sale del text con containerId = id de la flecha. edge_type =
//    primer válido del tipo de diagrama.
//  · Se descartan las flechas cuyos extremos no resuelven a formas existentes.

import type { DiagramSchema, DiagramNode, DiagramEdge } from '../../../../types';
import type { ImportOptions } from '../types';
import type {
  ExcalidrawDocument,
  ExcalidrawElement,
  ExcalidrawShape,
  ExcalidrawArrow,
  ExcalidrawText,
} from './types';
import { nodeTypeForShape, defaultEdgeType } from './mapping';

const SHAPE_TYPES = new Set(['rectangle', 'ellipse', 'diamond']);

function isShape(el: ExcalidrawElement): el is ExcalidrawShape {
  return SHAPE_TYPES.has(el.type);
}
function isArrow(el: ExcalidrawElement): el is ExcalidrawArrow {
  return el.type === 'arrow';
}
function isText(el: ExcalidrawElement): el is ExcalidrawText {
  return el.type === 'text';
}

export function fromExcalidraw(text: string, opts: ImportOptions): DiagramSchema {
  // JSON.parse puede lanzar SyntaxError con texto corrupto: el modal lo captura.
  const doc = JSON.parse(text) as ExcalidrawDocument;
  const elements = Array.isArray(doc?.elements) ? doc.elements : [];
  const live = elements.filter((el) => el && !el.isDeleted);

  // containerId → texto (la primera ocurrencia gana). Resuelve labels de formas y
  // de flechas en O(1).
  const textByContainer = new Map<string, string>();
  for (const el of live) {
    if (isText(el) && el.containerId && !textByContainer.has(el.containerId)) {
      textByContainer.set(el.containerId, el.text ?? '');
    }
  }

  // 1) Formas → nodos. Guardamos el id de la forma como id del nodo, para que las
  // flechas (que bindean por id de forma) resuelvan source/target directamente.
  const nodes: DiagramNode[] = [];
  const shapeIds = new Set<string>();
  for (const el of live) {
    if (!isShape(el)) continue;
    shapeIds.add(el.id);
    const label = textByContainer.get(el.id) ?? '';
    nodes.push({
      id: el.id,
      label,
      node_type: nodeTypeForShape(el.type, opts.diagramType),
      attributes: [],
      position: { x: el.x ?? 0, y: el.y ?? 0 },
    });
  }

  // 2) Flechas → aristas. Solo las que atan a dos formas existentes (integridad).
  const edges: DiagramEdge[] = [];
  const edgeType = defaultEdgeType(opts.diagramType);
  for (const el of live) {
    if (!isArrow(el)) continue;
    const source = el.startBinding?.elementId;
    const target = el.endBinding?.elementId;
    if (!source || !target) continue;
    if (!shapeIds.has(source) || !shapeIds.has(target)) continue;
    edges.push({
      id: el.id,
      source,
      target,
      label: textByContainer.get(el.id) ?? '',
      edge_type: edgeType,
    });
  }

  return {
    title: 'Diagrama importado',
    diagram_type: opts.diagramType,
    nodes,
    edges,
  };
}
