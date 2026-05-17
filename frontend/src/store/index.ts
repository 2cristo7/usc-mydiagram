import type { Message, DiagramNode, DiagramEdge, DiagramSchema, UIState } from "../types";
import { create } from "zustand";

interface MsgStore {
    messages: Message[];
    addMessage: (message: Message) => void;
    uiState: UIState;
    setUiState: (state: MsgStore['uiState']) => void;
}

interface DiagramStore {
    nodes : DiagramNode[];
    edges : DiagramEdge[];
    currentDiagram: DiagramSchema | null;
    setCurrentDiagram: (diagram: DiagramSchema) => void;
    updateNode(id: string, changes: Partial<DiagramNode>): void;
}

export type Store = MsgStore & DiagramStore;

export const useStore = create<Store>()((set) => ({

    messages: [],
    addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
    uiState: 'idle',
    setUiState: (state) => set({ uiState: state }),

    nodes: [],
    edges: [],
    currentDiagram: null,
    setCurrentDiagram: (diagram) => set({ 
        currentDiagram: diagram,
        nodes: diagram.nodes,
        edges: diagram.edges
     }),
     updateNode: (id, changes) => set((state) => ({
        nodes: state.nodes.map(node => node.id === id ? { ...node, ...changes } : node)
     }))
}));