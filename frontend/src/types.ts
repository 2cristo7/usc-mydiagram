import { z } from "zod";

export interface Message {
    id: string;
    text: string;
    sender: 'user' | 'system';
    timestamp: Date;
}

// S10.3 — Reinvención del "chat": no era una conversación, era un sistema de jobs
// (request → diagrama). Cada cambio del diagrama se persiste como una VERSIÓN en un
// diario lineal append-only (ver migración diagram_versions). El antiguo log de
// mensajes se SUBSUME aquí: las tarjetas de operación se derivan de las versiones.
//
// origin:
//   · generate/refine → hito del AGENTE (sale en la lista de operaciones).
//   · manual_edit     → edición a mano (NO sale en la lista; navegable con ◀ ▶).
//   · restore         → "volver a esta versión" (reaparece como hito en la lista).
export type VersionOrigin = 'generate' | 'refine' | 'manual_edit' | 'restore';

// Resumen del delta de una operación, para el "recibo" de la tarjeta.
export interface OpSummary {
    added?: string[];
    updated?: string[];
    deleted?: string[];
    addedEdges?: number;
    deletedEdges?: number;
}

// Metadata de una versión del diario (sin el snapshot `data`, que se trae al
// navegar). Es la unidad que pinta el panel de operaciones.
export interface VersionMeta {
    id: string;
    seq: number;
    origin: VersionOrigin;
    instruction: string | null;
    op_summary: OpSummary | null;
    // El diario es un ÁRBOL: id de la versión de la que se derivó esta. null =
    // raíz. Navegar a una versión y crear una nueva la cuelga de ahí; lo que queda
    // fuera del camino vivo son ramas muertas (se muestran arriba en la lista).
    parent_version_id: string | null;
    created_at: string;
}

export type UIState = 'idle' | 'generating' | 'ready' | 'error' | 'awaiting_clarification';

// S7.4 — el agente pausó pidiendo una aclaración: pregunta (+ opciones como
// botones) y el thread_id que debe volver con la respuesta para reanudar.
export interface Clarification {
    thread_id: string;
    question: string;
    options: string[];
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

// S10.3 — elección de tipo de diagrama cuando el backend detecta ambigüedad UML
// y emite `diagram:type_clarification`. Camino independiente del flujo refine
// (`agent:clarification` / thread_id), que NO se debe tocar.
export interface TypeChoiceOption {
    label: string;
    value: string; // diagram_type válido: p. ej. "sequence" o "use_case"
}

export interface PendingTypeChoice {
    question: string;
    options: TypeChoiceOption[];
}

// S7.5 — streaming visual de tool calls: el agente emite agent:tool_call cuando
// decide invocar una tool (antes de que corra) y agent:tool_result al terminar,
// con el delta declarado por el servidor (node/edge completos para add/update;
// los borrados van autodescritos en result.deleted_*).
export interface AgentToolCall {
    id: string;
    tool: string;
    args: Record<string, unknown>;
}

export interface AgentToolResult {
    id: string;
    tool: string;
    result: unknown;
    node?: DiagramNode;
    edge?: DiagramEdge;
}

// Entrada de la traza en vivo del chat: running mientras la tool corre,
// ok/error al llegar su tool_result.
export type ToolTraceStatus = 'running' | 'ok' | 'error';

export interface ToolTraceEntry {
    id: string;
    tool: string;
    args: Record<string, unknown>;
    status: ToolTraceStatus;
}

// S8.2 — el sub-contrato de diagrama (espejo del Pydantic del agente) se define con
// schemas Zod en vez de tipos a mano: el import de un .json es entrada externa y
// necesita validación en RUNTIME ("tipos en los bordes", visión global §2), que un
// tipo TS —borrado en compilación— no da. Los tipos se DERIVAN del schema con
// z.infer, así el schema es la única fuente de verdad (no hay riesgo de que tipo y
// validador se desincronicen). Los tipos puramente de UI (arriba) siguen siendo
// `type`/`interface`: no cruzan el borde del import.
export const diagramTypeSchema = z.enum([
    'erd', 'sequence', 'flowchart', 'architecture', 'mindmap', 'use_case',
]);

export const nodeTypeSchema = z.enum([
    'table', 'actor', 'step', 'service', 'database', 'queue', 'gateway',
    'topic', 'decision', 'terminator', 'person', 'system', 'container', 'component',
    'use_case',
]);

export const edgeTypeSchema = z.enum([
    'one_to_many', 'many_to_many', 'one_to_one', 'inherits', 'calls',
    'sequence', 'depends_on', 'association', 'flow', 'conditional',
    'include', 'extend',
]);

export const diagramNodeSchema = z.object({
    id: z.string(),
    label: z.string(),
    node_type: nodeTypeSchema,
    // Tolerante: un nodo sin `attributes` (editado a mano, otra versión) cae a [].
    attributes: z.array(z.string()).default([]),
    // Coordenadas persistidas. Opcional para compatibilidad con diagramas
    // importados sin posición (dagre da la posición inicial en ese caso).
    // NO se envía al agente Python (diagramToJson lo stripea).
    position: z.object({ x: z.number(), y: z.number() }).optional(),
});

// Datos puramente visuales del edge en el canvas (waypoints, forma, etiqueta
// deslizable, flechas). NO forman parte del contrato con el agente: se stripean
// en diagramToJson antes de enviar. Se persisten en el store para que sobrevivan
// al round-trip currentDiagram → DiagramToFlow → render.
export const edgeVisualDataSchema = z.object({
    label: z.string().optional(),
    labelT: z.number().optional(),
    waypoints: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
    shape: z.enum(['straight', 'elbow', 'curved', 'radial']).optional(),
    strokeStyle: z.enum(['normal', 'dashed', 'dotted']).optional(),
    // Color y grosor del trazo. Propiedades comunes a TODOS los edges; las usa
    // p. ej. el mapa mental para ramas coloreadas y de grosor decreciente por
    // nivel, sin necesitar un componente de edge propio.
    strokeColor: z.string().optional(),
    strokeWidth: z.number().optional(),
    sourceArrow: z.boolean().optional(),
    targetArrow: z.boolean().optional(),
    // Anclaje fijo del extremo sobre el perímetro del nodo, normalizado [0..1]
    // relativo a su caja. Si está presente, sustituye al anclaje flotante
    // automático (el usuario deslizó el extremo por el borde, estilo MIRO).
    sourceAnchor: z.object({ x: z.number(), y: z.number() }).optional(),
    targetAnchor: z.object({ x: z.number(), y: z.number() }).optional(),
    // Id de marker SVG personalizado (sin el prefijo url(#)). Cuando está presente,
    // override a sourceArrow/targetArrow con el marker concreto (p. ej. 'arrowHollow'
    // para la generalización UML de actores en casos de uso).
    markerEndId: z.string().optional(),
    markerStartId: z.string().optional(),
});

export const diagramEdgeSchema = z.object({
    id: z.string(),
    source: z.string(), // Node ID
    target: z.string(), // Node ID
    label: z.string(),
    // edge_type opcional: las aristas creadas a mano en el canvas no siempre
    // tienen una semántica de tipo (se asigna 'association' por defecto).
    edge_type: edgeTypeSchema.optional(),
    sourceHandle: z.string().optional(),
    targetHandle: z.string().optional(),
    // Visual-only; ver edgeVisualDataSchema. Se stripea antes de enviar al agente.
    data: edgeVisualDataSchema.optional(),
});

// Geometría manual de los contenedores de GRUPO de arquitectura (clave = id del
// contenedor, `group__Nombre`). Los grupos son derivados (no viven en `nodes`): su
// layout lo calcula ELK. Si el usuario redimensiona/mueve un contenedor, su
// geometría se guarda aquí y el layout la respeta. Solo-canvas: NO se envía al
// agente (diagramToJson solo manda diagram_type/nodes/edges).
export const groupLayoutSchema = z.record(
    z.string(),
    z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
);

export const diagramSchema = z.object({
    title: z.string(),
    diagram_type: diagramTypeSchema,
    nodes: z.array(diagramNodeSchema),
    edges: z.array(diagramEdgeSchema),
    // Override de geometría de los contenedores de grupo (arquitectura). Opcional:
    // un diagrama sin grupos o sin resize manual no lo lleva.
    group_layout: groupLayoutSchema.optional(),
});

// Schema del IMPORT: la estructura válida + integridad referencial. Una arista cuyo
// source/target no existe entre los nodos dejaría un diagrama roto en React Flow
// (arista huérfana que no se renderiza). Se rechaza el import entero antes de tocar
// el canvas (decisión S8.2; cubre el pendiente "validación de huérfanas en
// setCurrentDiagram").
export const diagramImportSchema = diagramSchema.refine(
    (d) => {
        const ids = new Set(d.nodes.map((n) => n.id));
        return d.edges.every((e) => ids.has(e.source) && ids.has(e.target));
    },
    { message: 'El diagrama tiene aristas que referencian nodos inexistentes (huérfanas)' },
);

export type DiagramType = z.infer<typeof diagramTypeSchema>;

// S10.2 — Etiquetas legibles + orden para el selector de tipo de la UI. Deriva
// del MISMO enum (diagramTypeSchema) que el contrato: añadir un tipo nuevo allí y
// olvidarlo aquí lo deja sin etiqueta, pero el valor sigue siendo válido. El
// "Automático" (que el agente clasifique) NO es un valor del enum: se modela como
// ausencia (null en el store / campo ausente en el mensaje), no como opción aquí.
export const DIAGRAM_TYPE_OPTIONS: { value: DiagramType; label: string }[] = [
    { value: 'erd', label: 'Entidad-Relación' },
    { value: 'sequence', label: 'Secuencia' },
    { value: 'flowchart', label: 'Diagrama de flujo' },
    { value: 'architecture', label: 'Arquitectura' },
    { value: 'mindmap', label: 'Mapa mental' },
    { value: 'use_case', label: 'Casos de uso' },
];

export type NodeType = z.infer<typeof nodeTypeSchema>;
export type EdgeType = z.infer<typeof edgeTypeSchema>;
export type DiagramNode = z.infer<typeof diagramNodeSchema>;
export type DiagramEdge = z.infer<typeof diagramEdgeSchema>;

// S10.3 — tipos de relación admitidos por cada tipo de diagrama, con etiqueta
// legible y orden de presentación. Fuente ÚNICA del selector "Tipo de relación"
// del panel de edición de aristas (EdgeContextMenu): cada diagrama solo expone la
// semántica que le es propia (un ERD no debe ofrecer «include»; un mapa mental no
// ofrece cardinalidades). Deriva del MISMO enum edgeTypeSchema; un edge_type nuevo
// allí que no se mapee aquí queda fuera del selector aunque siga siendo válido.
// El estilo visual de cada tipo lo decide edgeTypeStyle (ui/utils/edgeDefaults).
export const DIAGRAM_EDGE_TYPES: Record<DiagramType, { value: EdgeType; label: string }[]> = {
    erd: [
        { value: 'one_to_one', label: 'Uno a uno' },
        { value: 'one_to_many', label: 'Uno a muchos' },
        { value: 'many_to_many', label: 'Muchos a muchos' },
    ],
    flowchart: [
        { value: 'flow', label: 'Flujo' },
        { value: 'conditional', label: 'Condicional' },
    ],
    architecture: [
        { value: 'calls', label: 'Llama a' },
        { value: 'depends_on', label: 'Depende de' },
    ],
    use_case: [
        { value: 'association', label: 'Asociación' },
        { value: 'include', label: '«include»' },
        { value: 'extend', label: '«extend»' },
        { value: 'inherits', label: 'Generalización' },
    ],
    mindmap: [
        { value: 'association', label: 'Rama' },
    ],
    sequence: [
        { value: 'sequence', label: 'Mensaje' },
    ],
};

// S6.9 — degradación parcial: el diagrama es usable pero le faltó algo que el
// agente no pudo resolver tras agotar los reintentos. Una entrada por dimensión.
export type DegradationCategory = 'nodes' | 'edges' | 'structure';

export interface Degradation {
    category: DegradationCategory;
    reasons: string[];
}

export type DiagramSchema = z.infer<typeof diagramSchema>;

// Visual-only data stored in React Flow's edge `data` field. Not part of the
// DiagramEdge schema (which is the agent contract) — lives only in the canvas.
export interface EdgeVisualData {
  label?: string
  labelT?: number
  waypoints?: { x: number; y: number }[]
  shape?: 'straight' | 'elbow' | 'curved' | 'radial'
  strokeStyle?: 'normal' | 'dashed' | 'dotted'
  strokeColor?: string
  strokeWidth?: number
  sourceArrow?: boolean
  targetArrow?: boolean
  sourceAnchor?: { x: number; y: number }
  targetAnchor?: { x: number; y: number }
  markerEndId?: string
  markerStartId?: string
}
