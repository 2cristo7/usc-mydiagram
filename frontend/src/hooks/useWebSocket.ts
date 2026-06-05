import { useState, useEffect, useRef } from "react";
import type { Message, ConnectionState, Degradation, DegradationCategory, AgentToolCall, AgentToolResult } from "../types";
import { io, Socket } from "socket.io-client";
import { useStore } from "../store/index";
import { diagramToJson } from "../ui/utils/diagramToJson";

// Render diferenciado por categoría (S6.9 P4): cada degradación se traduce a un
// aviso de chat legible. Fallback genérico para una categoría futura sin etiqueta.
const DEGRADATION_LABELS: Record<DegradationCategory, string> = {
    nodes: 'No se pudieron generar algunos elementos',
    edges: 'Faltan algunas relaciones que no se pudieron resolver',
    structure: 'El diagrama puede estar estructuralmente incompleto',
};

function degradationMessages(degradations: Degradation[]): string[] {
    return degradations.map((d) => {
        const label = DEGRADATION_LABELS[d.category] ?? 'El diagrama quedó incompleto';
        const detail = d.reasons?.length ? `: ${d.reasons.join('; ')}` : '';
        return `⚠️ ${label}${detail}`;
    });
}

export function useWebSocket(url: string = 'ws://localhost:3001') {
    const {
        addNode, addEdge, addMessage, setUiState, setPendingClarification,
        updateNode, removeNode, removeEdge, applyDiagram,
        traceToolCall, traceToolResult, clearToolTrace,
    } = useStore();
    const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
    const socketRef = useRef<Socket | null>(null);


    useEffect(() => {

        try {
            socketRef.current = io('http://localhost:3001', { transports: ['websocket'] });
            const socket = socketRef.current;

            socket.on('connect', () => {
                setConnectionState('connected');
                console.log("WebSocket connected");
            });

            socket.on('diagram:node_ready', (node) => {
                addNode(node);
            });

            socket.on('diagram:edge_ready', (edge) => {
                addEdge(edge);
            });

            // S7.5 — el agente decidió invocar una tool (aún no ha corrido):
            // entra a la traza en vivo como 'running'.
            socket.on('agent:tool_call', (call: AgentToolCall) => {
                if (!call?.id || !call?.tool) return;
                traceToolCall({ id: call.id, tool: call.tool, args: call.args ?? {} });
            });

            // S7.5 — la tool terminó: estado en la traza + delta del canvas. El
            // delta lo declara el SERVIDOR (node/edge completos para add/update;
            // los borrados autodescritos en result.deleted_*): se aplica literal,
            // sin reimplementar semántica (cascade, slugs) en el cliente.
            socket.on('agent:tool_result', (data: AgentToolResult) => {
                const result = data?.result as Record<string, unknown> | undefined;
                const isError = !!(result && typeof result === 'object' && 'error' in result);
                if (!isError) {
                    switch (data?.tool) {
                        case 'add_node':
                            if (data.node) addNode(data.node);
                            break;
                        case 'update_node':
                            if (data.node) updateNode(data.node.id, data.node);
                            break;
                        case 'add_edge':
                            if (data.edge) addEdge(data.edge);
                            break;
                        case 'delete_node':
                            if (typeof result?.deleted_node === 'string') {
                                removeNode(result.deleted_node, Array.isArray(result.deleted_edges) ? result.deleted_edges : []);
                            }
                            break;
                        case 'delete_edge':
                            if (typeof result?.deleted_edge === 'string') {
                                removeEdge(result.deleted_edge);
                            }
                            break;
                    }
                }
                if (data?.id) traceToolResult(data.id, isError ? 'error' : 'ok');
            });

            socket.on('diagram:done', (data) => {
                // S7.5 — reconciliación incondicional: el done de un refinamiento
                // trae el snapshot completo del workspace (la verdad) y se aplica
                // SIEMPRE; si los eventos en vivo ya dejaron el canvas idéntico,
                // la guarda de idempotencia de applyDiagram evita el re-render.
                if (data?.diagram) {
                    const { currentDiagram } = useStore.getState();
                    applyDiagram({
                        title: data.title ?? currentDiagram?.title ?? '',
                        diagram_type: data.diagram.diagram_type,
                        nodes: data.diagram.nodes ?? [],
                        edges: data.diagram.edges ?? [],
                    });
                }
                addMessage({
                    id: crypto.randomUUID(),
                    text: `Diagrama generado: ${data?.title ?? 'sin título'}`,
                    sender: 'system',
                    timestamp: new Date(),
                });
                // Degradación parcial (S6.9): el diagrama es usable pero quedó algo
                // sin resolver → un aviso de chat por categoría, sin bloquear la UI.
                if (data?.degraded && Array.isArray(data.degradations)) {
                    for (const text of degradationMessages(data.degradations)) {
                        addMessage({
                            id: crypto.randomUUID(),
                            text,
                            sender: 'system',
                            timestamp: new Date(),
                        });
                    }
                }
                setUiState('ready');
            });

            // S7.4 — el agente pausó pidiendo aclaración: la pregunta entra al
            // chat como mensaje del sistema y las opciones se muestran como
            // botones (ChatPanel lee pendingClarification del store). El input
            // queda habilitado para respuesta libre.
            socket.on('agent:clarification', (data) => {
                addMessage({
                    id: crypto.randomUUID(),
                    text: data?.question ?? '¿Puedes aclarar tu petición?',
                    sender: 'system',
                    timestamp: new Date(),
                });
                setPendingClarification({
                    thread_id: data?.thread_id,
                    question: data?.question ?? '',
                    options: Array.isArray(data?.options) ? data.options : [],
                });
                setUiState('awaiting_clarification');
            });

            socket.on('diagram:error', (data) => {
                addMessage({
                    id: crypto.randomUUID(),
                    text: data?.error ?? 'Error generando el diagrama',
                    sender: 'system',
                    timestamp: new Date(),
                });
                setUiState('error');
            });

            socket.on('disconnect', () => {
                setConnectionState('disconnected');
                addMessage({
                    id: crypto.randomUUID(),
                    text: 'Conexión perdida durante la generación. Inténtalo de nuevo.',
                    sender: 'system',
                    timestamp: new Date(),
                });
                setUiState('error');
            });

            socket.on('connect_error', (error) => {
                setConnectionState('error');
                setUiState('error');
                console.error("WebSocket error:", error);
            });
        } catch (error) {
            setConnectionState('error');
            setUiState('error');
            console.error("Failed to create WebSocket:", error);
        }

        return () => {
            if (socketRef.current) {
                socketRef.current.disconnect();
            }
        }
    }, [url]);

    const sendMessage = (text: string) => {
        if (!text.trim()) return;

        // Añadir mensaje del usuario al estado
        const userMessage: Message = {
            id: crypto.randomUUID(),
            text,
            sender: 'user',
            timestamp: new Date(),
        };
        addMessage(userMessage);

        // S7.1 — el frontend tiene la señal más fiable y temprana para decidir
        // generación vs refinamiento: ¿existe ya un diagrama en el canvas? El texto
        // del prompt no lo revela ("añade Carrito" es refinamiento solo si hay
        // diagrama; sin él sería una generación). Se lee con getState() para evitar
        // capturar un currentDiagram obsoleto en el closure.
        // S7.5 — run nuevo: la traza del anterior se descarta.
        clearToolTrace();

        const { currentDiagram } = useStore.getState();
        if (currentDiagram) {
            socketRef.current?.emit('message:refine', {
                prompt: text,
                diagram: diagramToJson(currentDiagram),
            });
        } else {
            socketRef.current?.emit('message:send', text);
        }
        setUiState('generating');
    };

    // S7.4 — responder a la clarificación pendiente (botón u texto libre): la
    // respuesta viaja con el thread_id para reanudar ESA ejecución pausada.
    const sendClarificationAnswer = (answer: string) => {
        if (!answer.trim()) return;
        const { pendingClarification, addMessage, setPendingClarification, setUiState } = useStore.getState();
        if (!pendingClarification) return;

        addMessage({
            id: crypto.randomUUID(),
            text: answer,
            sender: 'user',
            timestamp: new Date(),
        });
        socketRef.current?.emit('message:clarification_answer', {
            thread_id: pendingClarification.thread_id,
            answer,
        });
        setPendingClarification(null);
        setUiState('generating');
    };

    return {connectionState, sendMessage, sendClarificationAnswer };
}

