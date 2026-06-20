// Mapeos compartidos export/import: qué node_type/edge_type admite cada tipo de
// diagrama y cómo se traduce un node_type a una forma Excalidraw. La fuente de
// verdad de los enums es types.ts (Zod); aquí solo acotamos el subconjunto válido
// por tipo de diagrama, igual que hace el agente (CLAUDE.md · node_types por tipo).

import type { DiagramType, NodeType, EdgeType } from '../../../../types';
import type { ExcalidrawElementType } from './types';

// node_types admitidos por tipo de diagrama (orden = preferencia de fallback).
export const NODE_TYPES_BY_DIAGRAM: Record<DiagramType, NodeType[]> = {
  erd: ['table'],
  sequence: ['actor'],
  flowchart: ['terminator', 'step', 'decision'],
  architecture: ['service', 'database', 'queue', 'gateway', 'person', 'system', 'container', 'component'],
  mindmap: ['topic'],
  use_case: ['actor', 'use_case', 'system'],
};

// edge_types admitidos por tipo de diagrama (orden = preferencia de fallback).
export const EDGE_TYPES_BY_DIAGRAM: Record<DiagramType, EdgeType[]> = {
  erd: ['one_to_one', 'one_to_many', 'many_to_many'],
  sequence: ['sequence'],
  flowchart: ['flow', 'conditional'],
  architecture: ['calls', 'depends_on'],
  mindmap: ['association'],
  use_case: ['association', 'include', 'extend', 'inherits'],
};

// node_type → forma Excalidraw (export). Decision rómbica; terminadores, actores,
// personas y bases de datos como elipse; el resto, rectángulo.
export function shapeForNodeType(nodeType: NodeType): ExcalidrawElementType {
  switch (nodeType) {
    case 'decision':
      return 'diamond';
    case 'terminator':
    case 'actor':
    case 'person':
    case 'database':
      return 'ellipse';
    default:
      return 'rectangle';
  }
}

// Forma Excalidraw → node_type, acotado al conjunto válido del diagrama (import).
// Heurística: diamond→decision, ellipse→terminator/actor/person/database; siempre
// cayendo al primer node_type válido del tipo si la preferencia no está admitida.
export function nodeTypeForShape(
  shape: 'rectangle' | 'ellipse' | 'diamond',
  diagramType: DiagramType,
): NodeType {
  const allowed = NODE_TYPES_BY_DIAGRAM[diagramType];
  const prefer = (...candidates: NodeType[]): NodeType => {
    const hit = candidates.find((c) => allowed.includes(c));
    return hit ?? allowed[0];
  };
  switch (shape) {
    case 'diamond':
      return prefer('decision');
    case 'ellipse':
      // Orden de preferencia entre los redondeados según el dominio del diagrama.
      return prefer('terminator', 'actor', 'person', 'database');
    default:
      return allowed[0];
  }
}

// edge_type por defecto del diagrama (import): primer válido del tipo.
export function defaultEdgeType(diagramType: DiagramType): EdgeType {
  return EDGE_TYPES_BY_DIAGRAM[diagramType][0];
}
