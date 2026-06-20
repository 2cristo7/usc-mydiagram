// FormatModule de draw.io (mxGraph XML plano). Export fiel (round-trip vía data-*);
// import HEURÍSTICO y con pérdida → importExperimental:true (el modal avisa). El
// registry (formats/index.ts) lo reúne con los demás formatos.

import type { FormatModule } from '../types';
import { toDrawio } from './export';
import { fromDrawio } from './import';

export const drawioFormat: FormatModule = {
  id: 'drawio',
  label: 'draw.io (.drawio)',
  extension: 'drawio',
  accept: '.drawio,.xml,application/xml,text/xml',
  canImport: true,
  canExport: true,
  importExperimental: true,
  // Fiel solo si TODO vértice lleva `data-node-type` (lo escribe nuestro export).
  // Un .drawio ajeno —o uno nuestro al que se le añadieron formas en draw.io— tiene
  // vértices sin marcar → su node_type se adivina por forma → con pérdida.
  importIsFaithful: (text: string) => {
    const vertices = (text.match(/\bvertex="1"/g) ?? []).length;
    const marked = (text.match(/\bdata-node-type=/g) ?? []).length;
    return vertices > 0 && marked >= vertices;
  },
  toContent: toDrawio,
  fromContent: fromDrawio,
};
