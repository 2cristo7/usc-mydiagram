// Export DiagramSchema → fichero .excalidraw (JSON). Cada nodo se vuelca como una
// forma (rectangle/ellipse/diamond según node_type) con su label en un text bound;
// cada arista como una flecha con start/endBinding a las formas y, si tiene label,
// un text bound a la flecha. Los `boundElements` se mantienen coherentes en ambos
// sentidos (la forma referencia su texto/flechas y viceversa).
//
// Determinismo (requisito): NO se usa Math.random(). seed/versionNonce y los ids de
// los elementos Excalidraw se derivan de un contador + un hash simple del id del
// nodo/arista, así un mismo diagrama produce SIEMPRE el mismo JSON (round-trip y
// tests reproducibles).

import type { DiagramSchema, DiagramNode } from '../../../../types';
import type {
  ExcalidrawDocument,
  ExcalidrawElement,
  ExcalidrawShape,
  ExcalidrawArrow,
  ExcalidrawText,
  BoundElement,
} from './types';
import { shapeForNodeType } from './mapping';

const NODE_W = 160;
const NODE_H = 80;

// Hash determinista (djb2) de una cadena → entero positivo de 32 bits. Sirve para
// derivar seed/versionNonce reproducibles sin Math.random().
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

// Campos comunes de un elemento Excalidraw con valores por defecto. El `key`
// alimenta seed/versionNonce de forma determinista.
function baseFields(key: string, counter: number) {
  return {
    angle: 0 as const,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [] as string[],
    frameId: null,
    roundness: null,
    seed: (hash(key) + counter * 1000003) >>> 0,
    version: 1,
    versionNonce: (hash(`${key}#nonce`) + counter * 9176) >>> 0,
    isDeleted: false,
    boundElements: [] as BoundElement[],
    updated: 1,
    link: null,
    locked: false,
  };
}

// Posición del nodo: la persistida o, si falta, una rejilla 5-columnas.
function positionFor(node: DiagramNode, index: number): { x: number; y: number } {
  if (node.position) return node.position;
  return { x: (index % 5) * 220, y: Math.floor(index / 5) * 140 };
}

export function toExcalidraw(diagram: DiagramSchema): string {
  const elements: ExcalidrawElement[] = [];
  let counter = 0;

  // id del nodo del diagrama → id de la forma Excalidraw, para resolver bindings.
  const shapeIdByNode = new Map<string, string>();
  // id de la forma → su entrada (para empujar boundElements de las flechas luego).
  const shapeById = new Map<string, ExcalidrawShape>();

  // 1) Formas + texto bound (un nodo = una forma con su etiqueta dentro).
  diagram.nodes.forEach((node, i) => {
    const shapeId = `shape-${counter}-${hash(node.id).toString(36)}`;
    counter++;
    const textId = `text-${counter}-${hash(node.id).toString(36)}`;
    counter++;

    const { x, y } = positionFor(node, i);

    const shape: ExcalidrawShape = {
      id: shapeId,
      type: shapeForNodeType(node.node_type),
      x,
      y,
      width: NODE_W,
      height: NODE_H,
      ...baseFields(node.id, counter),
    };
    shape.boundElements = [{ type: 'text', id: textId }];

    const text: ExcalidrawText = {
      id: textId,
      type: 'text',
      x: x + 8,
      y: y + NODE_H / 2 - 10,
      width: NODE_W - 16,
      height: 20,
      ...baseFields(`${node.id}:label`, counter),
      text: node.label,
      originalText: node.label,
      containerId: shapeId,
      textAlign: 'center',
      verticalAlign: 'middle',
      fontSize: 20,
      fontFamily: 1,
    };

    elements.push(shape, text);
    shapeIdByNode.set(node.id, shapeId);
    shapeById.set(shapeId, shape);
  });

  // 2) Flechas + (opcional) texto bound con la label de la arista.
  diagram.edges.forEach((edge) => {
    const srcShapeId = shapeIdByNode.get(edge.source);
    const tgtShapeId = shapeIdByNode.get(edge.target);
    // Sin formas resolubles no podemos atar la flecha: la omitimos (integridad).
    if (!srcShapeId || !tgtShapeId) return;

    const arrowId = `arrow-${counter}-${hash(edge.id).toString(36)}`;
    counter++;

    const src = shapeById.get(srcShapeId)!;
    const tgt = shapeById.get(tgtShapeId)!;
    // Punto de partida/llegada aproximado (centro de cada forma) para points/x/y.
    const sx = src.x + src.width / 2;
    const sy = src.y + src.height / 2;
    const tx = tgt.x + tgt.width / 2;
    const ty = tgt.y + tgt.height / 2;

    const arrow: ExcalidrawArrow = {
      id: arrowId,
      type: 'arrow',
      x: sx,
      y: sy,
      width: Math.abs(tx - sx),
      height: Math.abs(ty - sy),
      ...baseFields(edge.id, counter),
      points: [
        [0, 0],
        [tx - sx, ty - sy],
      ],
      startBinding: { elementId: srcShapeId, focus: 0, gap: 4 },
      endBinding: { elementId: tgtShapeId, focus: 0, gap: 4 },
    };

    // Coherencia bidireccional: las formas referencian la flecha.
    src.boundElements.push({ type: 'arrow', id: arrowId });
    tgt.boundElements.push({ type: 'arrow', id: arrowId });

    elements.push(arrow);

    if (edge.label) {
      const labelId = `text-${counter}-${hash(edge.id).toString(36)}`;
      counter++;
      const label: ExcalidrawText = {
        id: labelId,
        type: 'text',
        x: (sx + tx) / 2,
        y: (sy + ty) / 2,
        width: 80,
        height: 20,
        ...baseFields(`${edge.id}:label`, counter),
        text: edge.label,
        originalText: edge.label,
        containerId: arrowId,
        textAlign: 'center',
        verticalAlign: 'middle',
        fontSize: 20,
        fontFamily: 1,
      };
      arrow.boundElements.push({ type: 'text', id: labelId });
      elements.push(label);
    }
  });

  const doc: ExcalidrawDocument = {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements,
    appState: { viewBackgroundColor: '#ffffff' },
    files: {},
  };

  return JSON.stringify(doc, null, 2);
}
