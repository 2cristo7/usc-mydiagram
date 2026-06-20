// Formato nativo .mdia — el DiagramSchema completo serializado como JSON. Sin
// pérdida: es el round-trip de referencia. El tipo de diagrama y las posiciones
// viajan dentro, así que el import IGNORA opts.diagramType (lo dicta el fichero).
//
// Antes vivía inline en ExportMenu/download; aquí se modela como FormatModule para
// que el registry sea la única fuente de verdad de formatos.

import type { DiagramSchema } from '../../../types';
import type { FormatModule } from './types';

export const nativeFormat: FormatModule = {
  id: 'native',
  label: 'MydIAgram (.mdia)',
  extension: 'mdia',
  accept: '.mdia,application/json,.json',
  canImport: true,
  canExport: true,
  toContent: (diagram: DiagramSchema) => JSON.stringify(diagram, null, 2),
  // JSON.parse puede lanzar SyntaxError (fichero no-JSON): el modal lo captura. El
  // resultado es candidato — diagramImportSchema valida forma, enums y huérfanas.
  fromContent: (text: string) => JSON.parse(text) as DiagramSchema,
};
