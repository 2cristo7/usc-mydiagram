// Import/export multiformato — contrato compartido.
//
// Cada formato de fichero (native .mdia, Mermaid, draw.io, Excalidraw) se modela
// como un FormatModule uniforme. El registry (index.ts) los reúne y es la ÚNICA
// fuente de verdad de qué formatos existen y qué capacidades tiene cada uno: lo
// consumen tanto el menú de exportación como el modal de importación.
//
// Border de validación (decisión S8.2): un FormatModule.fromContent SOLO produce
// un DiagramSchema candidato; NUNCA lo da por válido. Quien llama (el modal) lo
// pasa SIEMPRE por diagramImportSchema.safeParse antes de tocar el canvas. Así
// ningún formato —por muy heurístico que sea su parser— puede meter un diagrama
// con aristas huérfanas o enums inválidos. Las posiciones que un formato no
// aporte (Mermaid no las tiene) se dejan ausentes: los layouts existentes
// (dagre/sequenceLayout/…) las generan al renderizar.

import type { DiagramSchema, DiagramType } from '../../../types';

export interface ImportOptions {
  // Tipo de diagrama elegido por el usuario en el modal (decisión: selección
  // manual siempre). Los formatos visuales (draw.io/Excalidraw) lo NECESITAN para
  // mapear formas → node_type; Mermaid lo usa para elegir la gramática; native lo
  // ignora (el tipo viaja dentro del propio .mdia).
  diagramType: DiagramType;
}

export interface FormatModule {
  // Identificador estable del formato ('native' | 'mermaid' | 'drawio' | 'excalidraw').
  id: string;
  // Etiqueta legible para los selectores de la UI.
  label: string;
  // Extensión de fichero SIN punto ('mdia' | 'mmd' | 'drawio' | 'excalidraw').
  extension: string;
  // Extensiones/MIME aceptados al importar (atributo accept del input file).
  accept: string;
  canImport: boolean;
  canExport: boolean;
  // El import es heurístico y con pérdida (draw.io / Excalidraw): el modal avisa.
  importExperimental?: boolean;
  // Para formatos importExperimental: dado el contenido concreto del fichero,
  // decide si ESTE fichero es un round-trip FIEL (lleva todos nuestros marcadores
  // de semántica) y por tanto NO pierde información. El modal solo muestra el aviso
  // de "importación experimental" cuando importExperimental && !importIsFaithful.
  // Si no se define, se asume que cualquier fichero del formato es con pérdida.
  importIsFaithful?: (text: string) => boolean;
  // Serializa el diagrama interno al texto del formato. Indefinido si !canExport.
  toContent?: (diagram: DiagramSchema) => string;
  // Parsea el texto del formato a un DiagramSchema CANDIDATO (sin validar; quien
  // llama corre diagramImportSchema). Indefinido si !canImport. Puede lanzar si el
  // texto está corrupto: el modal captura y muestra un toast accionable.
  fromContent?: (text: string, opts: ImportOptions) => DiagramSchema;
}
