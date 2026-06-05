import type { Message, DiagramNode, DiagramEdge, DiagramSchema, UIState, Clarification, AgentToolCall, ToolTraceEntry } from "../types";
import { create } from "zustand";

interface MsgStore {
    messages: Message[];
    addMessage: (message: Message) => void;
    uiState: UIState;
    setUiState: (state: MsgStore['uiState']) => void;
    // S7.4 — clarificación pendiente del agente (null si no hay ninguna)
    pendingClarification: Clarification | null;
    setPendingClarification: (c: Clarification | null) => void;
    // S7.5 — traza en vivo de tool calls del run actual. Se limpia al lanzar un
    // run nuevo (sendMessage), NO al responder una clarificación: la reanudación
    // continúa el MISMO run y la traza sigue acumulando.
    toolTrace: ToolTraceEntry[];
    traceToolCall: (call: AgentToolCall) => void;
    traceToolResult: (id: string, status: 'ok' | 'error') => void;
    clearToolTrace: () => void;
}

interface DiagramStore {
    nodes : DiagramNode[];
    edges : DiagramEdge[];
    currentDiagram: DiagramSchema | null;
    setCurrentDiagram: (diagram: DiagramSchema) => void;
    updateNode(id: string, changes: Partial<DiagramNode>): void;
    addNode: (node: DiagramNode) => void;
    addEdge: (edge: DiagramEdge) => void;
    // S7.5 — deltas del agente. El cascade de removeNode lo declara el SERVIDOR
    // (deleted_edges): aquí se aplica literal, sin reinferir qué aristas caen.
    removeNode: (id: string, edgeIds: string[]) => void;
    removeEdge: (id: string) => void;
    // S7.5 — reconciliación del done: aplica el snapshot completo SIEMPRE, con
    // guarda de idempotencia del render (no reemplazar estado React idéntico).
    applyDiagram: (diagram: DiagramSchema) => void;
}

export type Store = MsgStore & DiagramStore;

export const useStore = create<Store>()((set) => ({

    messages: [],
    addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
    uiState: 'idle',
    setUiState: (state) => set({ uiState: state }),
    pendingClarification: null,
    setPendingClarification: (c) => set({ pendingClarification: c }),

    toolTrace: [],
    traceToolCall: (call) => set((state) => ({
        toolTrace: [...state.toolTrace, { ...call, status: 'running' }],
    })),
    traceToolResult: (id, status) => set((state) => ({
        toolTrace: state.toolTrace.map((entry) => entry.id === id ? { ...entry, status } : entry),
    })),
    clearToolTrace: () => set({ toolTrace: [] }),

    nodes: [],
    edges: [],
    currentDiagram: null,
    setCurrentDiagram: (diagram) => set({ 
        currentDiagram: diagram,
        nodes: diagram.nodes,
        edges: diagram.edges
     }),
     updateNode: (id, changes) => set((state) => ({
        nodes: state.nodes.map(node => node.id === id ? { ...node, ...changes } : node),
        currentDiagram: state.currentDiagram ? { ...state.currentDiagram, nodes: state.currentDiagram.nodes.map(node => node.id === id ? { ...node, ...changes } : node) } : null
     })),
     addNode: (node: DiagramNode) => set((state) => {
        const updatedNodes = [...state.nodes, node]
        return {
            nodes: updatedNodes,
            currentDiagram: state.currentDiagram
                ? { ...state.currentDiagram, nodes: updatedNodes }
                : { title: '', diagram_type: null, nodes: updatedNodes, edges: [] } as unknown as DiagramSchema,
        }
     }),
     addEdge: (edge: DiagramEdge) => set((state) => {
        const updatedEdges = [...state.edges, edge]
        return {
            edges: updatedEdges,
            currentDiagram: state.currentDiagram
                ? { ...state.currentDiagram, edges: updatedEdges }
                : { title: '', diagram_type: null, nodes: [], edges: updatedEdges } as unknown as DiagramSchema,
        }
     }),
     removeNode: (id, edgeIds) => set((state) => {
        const cascade = new Set(edgeIds)
        const nodes = state.nodes.filter((n) => n.id !== id)
        const edges = state.edges.filter((e) => !cascade.has(e.id))
        return {
            nodes,
            edges,
            currentDiagram: state.currentDiagram ? { ...state.currentDiagram, nodes, edges } : null,
        }
     }),
     removeEdge: (id) => set((state) => {
        const edges = state.edges.filter((e) => e.id !== id)
        return {
            edges,
            currentDiagram: state.currentDiagram ? { ...state.currentDiagram, edges } : null,
        }
     }),
     applyDiagram: (diagram) => set((state) => {
        // El done SIEMPRE manda (reconciliación incondicional), pero si los
        // eventos en vivo ya dejaron el canvas idéntico, reemplazar estado React
        // igual-pero-nuevo resetearía selección/edición sin cambiar nada visible.
        // La guarda solo puede fallar hacia el lado inofensivo: un "distinto"
        // espurio aplica el snapshot de más (= lo que haríamos sin guarda).
        const same = state.currentDiagram !== null
            && JSON.stringify({ t: state.currentDiagram.diagram_type, n: state.nodes, e: state.edges })
                === JSON.stringify({ t: diagram.diagram_type, n: diagram.nodes, e: diagram.edges })
        if (same) return {}
        return {
            currentDiagram: diagram,
            nodes: diagram.nodes,
            edges: diagram.edges,
        }
     }),
}));

