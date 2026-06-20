// Tipos mínimos del subconjunto del formato Excalidraw que este conversor usa.
// No modelamos el esquema completo de Excalidraw (decenas de campos por elemento):
// solo lo que necesitamos para round-trip de formas, flechas y texto bound. Evita
// `any` en el contrato (visión global §2: tipos en los bordes).

// Geometría/estilo común a TODO elemento Excalidraw. Los valores son los que
// Excalidraw espera por defecto; los rellenamos de forma determinista (sin random).
export interface ExcalidrawElementBase {
  id: string;
  type: ExcalidrawElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: 0;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: string;
  strokeWidth: number;
  strokeStyle: string;
  roughness: number;
  opacity: number;
  groupIds: string[];
  frameId: string | null;
  roundness: unknown | null;
  seed: number;
  version: number;
  versionNonce: number;
  isDeleted: boolean;
  boundElements: BoundElement[];
  updated: number;
  link: string | null;
  locked: boolean;
}

export type ExcalidrawElementType =
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'arrow'
  | 'text';

// Referencia que una forma/flecha guarda hacia su texto o flecha asociada.
export interface BoundElement {
  type: 'text' | 'arrow';
  id: string;
}

// Binding de un extremo de flecha a una forma.
export interface PointBinding {
  elementId: string;
  focus: number;
  gap: number;
}

// Forma (rectangle/ellipse/diamond): un nodo del diagrama.
export interface ExcalidrawShape extends ExcalidrawElementBase {
  type: 'rectangle' | 'ellipse' | 'diamond';
}

// Flecha: una arista del diagrama.
export interface ExcalidrawArrow extends ExcalidrawElementBase {
  type: 'arrow';
  points: [number, number][];
  startBinding: PointBinding | null;
  endBinding: PointBinding | null;
}

// Texto. Si `containerId` está presente, va "bound" dentro de esa forma/flecha
// (es su etiqueta); si no, es texto suelto.
export interface ExcalidrawText extends ExcalidrawElementBase {
  type: 'text';
  text: string;
  originalText: string;
  containerId: string | null;
  textAlign: string;
  verticalAlign: string;
  fontSize: number;
  fontFamily: number;
}

export type ExcalidrawElement =
  | ExcalidrawShape
  | ExcalidrawArrow
  | ExcalidrawText;

export interface ExcalidrawDocument {
  type: 'excalidraw';
  version: number;
  source: string;
  elements: ExcalidrawElement[];
  appState: { viewBackgroundColor: string };
  files: Record<string, unknown>;
}
