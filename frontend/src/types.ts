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

export type DiagramType = 'erd' | 'uml_class' | 'sequence' | 'flowchart' | 'architecture' | 'state_machine' | 'mindmap';

export type NodeType =  'table' | 'class' | 'actor' | 'step' | 'service' | 'database' | 'queue' | 'gateway' | 'state' | 'topic' | 'decision' | 'terminator' | 'person' | 'system' | 'container' | 'component';

export type EdgeType = 'one_to_many' | 'many_to_many' | 'one_to_one' | 'inherits' | 'implements' | 'calls' | 'sequence' | 'transition' | 'depends_on' | 'association' | 'flow' | 'conditional';

export interface DiagramNode {
    id: string;
    label: string;
    node_type: NodeType;
    attributes: string[];
}

export interface DiagramEdge {
    id: string;
    source: string; // Node ID
    target: string; // Node ID
    label: string;
    edge_type: EdgeType;
}

// S6.9 — degradación parcial: el diagrama es usable pero le faltó algo que el
// agente no pudo resolver tras agotar los reintentos. Una entrada por dimensión.
export type DegradationCategory = 'nodes' | 'edges' | 'structure';

export interface Degradation {
    category: DegradationCategory;
    reasons: string[];
}

export interface DiagramSchema {
    title: string;
    diagram_type: DiagramType;
    nodes: DiagramNode[];
    edges: DiagramEdge[];
}
