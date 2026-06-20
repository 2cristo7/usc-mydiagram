// FormatModule del formato Excalidraw (.excalidraw). Import heurístico y con
// pérdida (importExperimental): mapea formas/flechas → nodos/aristas acotando los
// tipos con el diagram_type elegido en el modal. Export sin pérdida estructural
// (nodos, aristas, labels y posiciones), aunque descarta la semántica de
// node_type/edge_type que Excalidraw no representa.

import type { FormatModule } from '../types';
import { toExcalidraw } from './export';
import { fromExcalidraw } from './import';

export const excalidrawFormat: FormatModule = {
  id: 'excalidraw',
  label: 'Excalidraw (.excalidraw)',
  extension: 'excalidraw',
  accept: '.excalidraw,application/json,.json',
  canImport: true,
  canExport: true,
  importExperimental: true,
  toContent: toExcalidraw,
  fromContent: fromExcalidraw,
};
