/**
 * Mapeo canónico diagram_type → node_types válidos para ese tipo de diagrama.
 * Fuente de autoridad: agent/schemas.py ALLOWED_NODE_TYPES (backend Python).
 * Se usa en la paleta de nodos del EditToolbar para mostrar solo los tipos
 * permitidos según el diagrama actualmente cargado.
 */

import type { DiagramType, NodeType } from '../../types';

export interface NodeTypeInfo {
  /** Valor exacto del enum NodeType (coincide con el backend). */
  type: NodeType;
  /** Etiqueta legible en español para mostrar en la paleta. */
  label: string;
  /** Símbolo visual breve para el icono de la paleta (texto o emoji). */
  symbol: string;
}

export const DIAGRAM_NODE_TYPES: Record<DiagramType, NodeTypeInfo[]> = {
  erd: [
    { type: 'table', label: 'Tabla', symbol: '▦' },
  ],
  sequence: [
    { type: 'actor', label: 'Actor', symbol: '◎' },
  ],
  flowchart: [
    { type: 'terminator', label: 'Inicio/Fin', symbol: '⬭' },
    { type: 'step',       label: 'Paso',       symbol: '▭' },
    { type: 'decision',   label: 'Decisión',   symbol: '◇' },
  ],
  architecture: [
    { type: 'service',   label: 'Servicio',    symbol: '⬜' },
    { type: 'database',  label: 'Base de datos', symbol: '⬡' },
    { type: 'queue',     label: 'Cola',        symbol: '▷' },
    { type: 'gateway',   label: 'Gateway',     symbol: '◈' },
    { type: 'person',    label: 'Persona',     symbol: '◯' },
    { type: 'system',    label: 'Sistema',     symbol: '⬛' },
    { type: 'container', label: 'Contenedor',  symbol: '▢' },
    { type: 'component', label: 'Componente',  symbol: '◧' },
  ],
  mindmap: [
    { type: 'topic', label: 'Tema', symbol: '●' },
  ],
  use_case: [
    { type: 'actor',    label: 'Actor',          symbol: '◯' },
    { type: 'use_case', label: 'Caso de uso',    symbol: '⬭' },
    { type: 'system',   label: 'Subsistema',     symbol: '▭' },
  ],
};

/**
 * Devuelve los node_types válidos para un diagram_type dado.
 * Si el tipo es desconocido o null, devuelve un array vacío.
 */
export function getNodeTypesForDiagram(diagramType: DiagramType | null | undefined): NodeTypeInfo[] {
  if (!diagramType) return [];
  return DIAGRAM_NODE_TYPES[diagramType] ?? [];
}
