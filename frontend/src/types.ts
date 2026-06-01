export interface Message {
    id: string;
    text: string;
    sender: 'user' | 'system';
    timestamp: Date;
}

export type UIState = 'idle' | 'generating' | 'ready' | 'error';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

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
