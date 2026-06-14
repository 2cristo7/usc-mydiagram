import { z } from "zod";

export interface Message {
    id: string;
    text: string;
    sender: 'user' | 'system';
    timestamp: Date;
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
    'erd', 'uml_class', 'sequence', 'flowchart', 'architecture', 'state_machine', 'mindmap',
]);

export const nodeTypeSchema = z.enum([
    'table', 'class', 'actor', 'step', 'service', 'database', 'queue', 'gateway',
    'state', 'topic', 'decision', 'terminator', 'person', 'system', 'container', 'component',
]);

export const edgeTypeSchema = z.enum([
    'one_to_many', 'many_to_many', 'one_to_one', 'inherits', 'implements', 'calls',
    'sequence', 'transition', 'depends_on', 'association', 'flow', 'conditional',
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
    shape: z.enum(['straight', 'elbow', 'curved']).optional(),
    strokeStyle: z.enum(['normal', 'dashed', 'dotted']).optional(),
    sourceArrow: z.boolean().optional(),
    targetArrow: z.boolean().optional(),
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

export const diagramSchema = z.object({
    title: z.string(),
    diagram_type: diagramTypeSchema,
    nodes: z.array(diagramNodeSchema),
    edges: z.array(diagramEdgeSchema),
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
    { value: 'uml_class', label: 'Clases UML' },
    { value: 'sequence', label: 'Secuencia' },
    { value: 'flowchart', label: 'Diagrama de flujo' },
    { value: 'architecture', label: 'Arquitectura' },
    { value: 'state_machine', label: 'Máquina de estados' },
    { value: 'mindmap', label: 'Mapa mental' },
];

export type NodeType = z.infer<typeof nodeTypeSchema>;
export type EdgeType = z.infer<typeof edgeTypeSchema>;
export type DiagramNode = z.infer<typeof diagramNodeSchema>;
export type DiagramEdge = z.infer<typeof diagramEdgeSchema>;

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
  shape?: 'straight' | 'elbow' | 'curved'
  strokeStyle?: 'normal' | 'dashed' | 'dotted'
  sourceArrow?: boolean
  targetArrow?: boolean
}
