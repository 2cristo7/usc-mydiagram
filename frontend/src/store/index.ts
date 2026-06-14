import type { Message, DiagramNode, DiagramEdge, DiagramSchema, DiagramType, UIState, Clarification, AgentToolCall, ToolTraceEntry } from "../types";
import { create } from "zustand";
import { persistCurrentDiagram } from "../lib/api";

// Fase de animación de generación por streaming.
// - 'idle': sin diagrama en curso, comportamiento normal.
// - 'staging': los nodos/aristas van llegando; se muestran en la fila almacén.
// - 'assembling': diagram:done recibido; animando transición al layout final.
// - 'done': animación completada; canvas interactivo normal.
// Solo la generación/refinamiento por streaming pasa por 'staging' y 'assembling'.
// Cargar un diagrama guardado va directamente a 'done'.
export type GenerationPhase = 'idle' | 'staging' | 'assembling' | 'done';

// Debounce de persistencia de posición: si el usuario arrastra rápido varios
// nodos, esperamos 800 ms tras el último drag antes de llamar al servidor.
let _positionSaveTimer: ReturnType<typeof setTimeout> | null = null
function schedulePersist() {
    if (_positionSaveTimer !== null) clearTimeout(_positionSaveTimer)
    _positionSaveTimer = setTimeout(() => {
        _positionSaveTimer = null
        persistCurrentDiagram()
    }, 800)
}

interface MsgStore {
    messages: Message[];
    addMessage: (message: Message) => void;
    // S10.x — reemplaza la conversación completa. Lo usa la carga del historial
    // para restaurar los mensajes del diagrama abierto (addMessage solo añade).
    setMessages: (messages: Message[]) => void;
    uiState: UIState;
    setUiState: (state: MsgStore['uiState']) => void;
    // Fase de animación del streaming. Independiente de uiState para no
    // mezclar lógica de conexión con lógica de presentación de animación.
    generationPhase: GenerationPhase;
    setGenerationPhase: (phase: GenerationPhase) => void;
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
    // S9.3 — id de la fila en BD del diagrama vivo. null = nunca guardado (un
    // diagrama recién generado o importado) → el próximo guardado es POST; con
    // id → PATCH. Se fija al recibir la respuesta del POST o al cargar del
    // historial; se resetea a null al empezar una generación desde cero.
    currentDiagramId: string | null;
    setCurrentDiagramId: (id: string | null) => void;
    // S9.3b — prompt que ORIGINÓ el diagrama vivo (solo generación, no
    // refinamiento). Habilita el botón "Regenerar" (redo): rehace ese prompt
    // saltándose la caché y sobrescribiendo su entrada. null = el diagrama no se
    // generó en esta sesión (importado o cargado del historial sin prompt) → no
    // hay nada que regenerar.
    lastGenerationPrompt: string | null;
    setLastGenerationPrompt: (prompt: string | null) => void;
    // S10.2 — tipo preseleccionado en la UI para la PRÓXIMA generación. null =
    // automático (el agente clasifica, comportamiento histórico). Persiste entre
    // mensajes: el usuario lo elige una vez y se respeta hasta que lo cambie.
    selectedDiagramType: DiagramType | null;
    setSelectedDiagramType: (type: DiagramType | null) => void;
    // S10.2 — tipo que ORIGINÓ el diagrama vivo (espejo de lastGenerationPrompt),
    // para que "Regenerar" conserve el tipo forzado en vez de volver a auto. null
    // = se generó en automático o no se generó en esta sesión.
    lastGenerationType: DiagramType | null;
    setLastGenerationType: (type: DiagramType | null) => void;
    setCurrentDiagram: (diagram: DiagramSchema) => void;
    updateNode(id: string, changes: Partial<DiagramNode>): void;
    // Persiste la posición del nodo tras un drag. Actualiza DiagramNode.position
    // en el store (nodes[] y currentDiagram.nodes[]) y dispara guardado en BD.
    updateNodePosition(id: string, position: { x: number; y: number }): void;
    // Migration path: EditableEdge uses this to persist inline label/type edits.
    // updates maps to Partial<DiagramEdge> (the domain type stored in edge data).
    updateEdge(edgeId: string, updates: Partial<DiagramEdge>): void;
    addNode: (node: DiagramNode) => void;
    addEdge: (edge: DiagramEdge) => void;
    // S7.5 — deltas del agente. El cascade de removeNode lo declara el SERVIDOR
    // (deleted_edges): aquí se aplica literal, sin reinferir qué aristas caen.
    removeNode: (id: string, edgeIds: string[]) => void;
    removeEdge: (id: string) => void;
    // S7.5 — reconciliación del done: aplica el snapshot completo SIEMPRE, con
    // guarda de idempotencia del render (no reemplazar estado React idéntico).
    applyDiagram: (diagram: DiagramSchema) => void;
    // Regenerar: vacía nodes/edges del canvas y de currentDiagram, conservando
    // id/title/diagram_type para que applyDiagram reconcilie sobre el MISMO
    // diagrama (no crea uno nuevo). No-op si no hay diagrama vivo.
    clearDiagramContent: () => void;
}

export type Store = MsgStore & DiagramStore;

export const useStore = create<Store>()((set) => ({

    messages: [],
    addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
    setMessages: (messages) => set({ messages }),
    uiState: 'idle',
    setUiState: (state) => set({ uiState: state }),
    generationPhase: 'idle',
    setGenerationPhase: (phase) => set({ generationPhase: phase }),
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
    currentDiagramId: null,
    setCurrentDiagramId: (id) => set({ currentDiagramId: id }),
    lastGenerationPrompt: null,
    setLastGenerationPrompt: (prompt) => set({ lastGenerationPrompt: prompt }),
    selectedDiagramType: null,
    setSelectedDiagramType: (type) => set({ selectedDiagramType: type }),
    lastGenerationType: null,
    setLastGenerationType: (type) => set({ lastGenerationType: type }),
    setCurrentDiagram: (diagram) => set({
        currentDiagram: diagram,
        nodes: diagram.nodes,
        edges: diagram.edges
     }),
     updateNode: (id, changes) => set((state) => ({
        nodes: state.nodes.map(node => node.id === id ? { ...node, ...changes } : node),
        currentDiagram: state.currentDiagram ? { ...state.currentDiagram, nodes: state.currentDiagram.nodes.map(node => node.id === id ? { ...node, ...changes } : node) } : null
     })),
     updateEdge: (edgeId, updates) => set((state) => ({
        edges: state.edges.map(edge => edge.id === edgeId ? { ...edge, ...updates } : edge),
        currentDiagram: state.currentDiagram ? { ...state.currentDiagram, edges: state.currentDiagram.edges.map(edge => edge.id === edgeId ? { ...edge, ...updates } : edge) } : null,
     })),
     updateNodePosition: (id, position) => {
        set((state) => ({
            nodes: state.nodes.map((node) =>
                node.id === id ? { ...node, position } : node
            ),
            currentDiagram: state.currentDiagram
                ? {
                    ...state.currentDiagram,
                    nodes: state.currentDiagram.nodes.map((node) =>
                        node.id === id ? { ...node, position } : node
                    ),
                  }
                : null,
        }))
        schedulePersist()
     },
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
     clearDiagramContent: () => set((state) => {
        if (!state.currentDiagram) return {}
        return {
            nodes: [],
            edges: [],
            currentDiagram: {
                ...state.currentDiagram,
                nodes: [],
                edges: [],
            },
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

