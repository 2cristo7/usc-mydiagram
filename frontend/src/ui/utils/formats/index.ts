// Registry de formatos de import/export. ÚNICA fuente de verdad de qué formatos
// hay y qué capacidades tiene cada uno: lo consumen el menú de exportación
// (ExportMenu) y el modal de importación (ImportDiagramModal).
//
// Añadir un formato = crear su carpeta con un FormatModule y añadirlo a FORMATS.
// Nada más cambia: los selectores de UME se derivan de esta lista.

import type { FormatModule } from './types';
import { nativeFormat } from './native';
import { mermaidFormat } from './mermaid';
import { drawioFormat } from './drawio';
import { excalidrawFormat } from './excalidraw';

export type { FormatModule, ImportOptions } from './types';

export const FORMATS: FormatModule[] = [
  nativeFormat,
  mermaidFormat,
  drawioFormat,
  excalidrawFormat,
];

export function getFormat(id: string): FormatModule | undefined {
  return FORMATS.find((f) => f.id === id);
}

export const exportFormats = (): FormatModule[] => FORMATS.filter((f) => f.canExport);
export const importFormats = (): FormatModule[] => FORMATS.filter((f) => f.canImport);

/**
 * Autodetecta el formato de un fichero importado a partir de su contenido (señal
 * primaria, más fiable) y su nombre (extensión como fallback). Decisión S10.3: el
 * modal de import ya NO pide el formato; lo deduce. El TIPO de diagrama sí lo
 * sigue eligiendo el usuario (la semántica no siempre está en el fichero).
 *
 * Devuelve undefined si no reconoce el fichero como ninguno de los formatos
 * soportados (el modal lo trata como error accionable).
 */
export function detectFormat(filename: string, text: string): FormatModule | undefined {
  const name = filename.toLowerCase();
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  const head = text.trimStart();

  // 1) Señales de CONTENIDO (preferidas sobre la extensión).
  // draw.io / mxGraph XML
  if (head.startsWith('<') && /<(mxGraphModel|mxfile)\b/.test(text)) {
    return getFormat('drawio');
  }
  // JSON: distinguir Excalidraw (type:"excalidraw") de nativo (.mdia) por firma.
  if (head.startsWith('{')) {
    try {
      const obj = JSON.parse(text) as Record<string, unknown>;
      if (obj && obj.type === 'excalidraw') return getFormat('excalidraw');
      if (obj && (typeof obj.diagram_type === 'string' || Array.isArray(obj.nodes))) {
        return getFormat('native');
      }
    } catch {
      /* JSON inválido: cae a la heurística por extensión más abajo. */
    }
  }
  // Mermaid: primera línea no vacía con una palabra clave de su DSL.
  const firstLine = (text.split('\n').find((l) => l.trim().length > 0) ?? '').trim();
  if (/^(flowchart|graph|sequenceDiagram|erDiagram|mindmap|classDiagram|stateDiagram(-v2)?|C4Context|journey|gantt|pie)\b/.test(firstLine)) {
    return getFormat('mermaid');
  }

  // 2) Fallback por EXTENSIÓN.
  switch (ext) {
    case 'mdia':
    case 'json':
      return getFormat('native');
    case 'excalidraw':
      return getFormat('excalidraw');
    case 'drawio':
    case 'xml':
      return getFormat('drawio');
    case 'mmd':
    case 'mermaid':
      return getFormat('mermaid');
    default:
      return undefined;
  }
}
