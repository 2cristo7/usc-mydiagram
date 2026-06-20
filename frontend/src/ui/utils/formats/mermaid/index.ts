// FormatModule del formato Mermaid (.mmd). Texto plano, con pérdida según el tipo
// de diagrama (flowchart/sequence/erd/mindmap tienen gramática nativa;
// architecture/use_case se aproximan). El import elige la gramática por
// opts.diagramType, no por la cabecera del fichero.

import type { FormatModule } from '../types';
import { toMermaid } from './export';
import { fromMermaid } from './import';

export const mermaidFormat: FormatModule = {
  id: 'mermaid',
  label: 'Mermaid (.mmd)',
  extension: 'mmd',
  accept: '.mmd,.mermaid,.txt,text/plain',
  canImport: true,
  canExport: true,
  toContent: toMermaid,
  fromContent: fromMermaid,
};
