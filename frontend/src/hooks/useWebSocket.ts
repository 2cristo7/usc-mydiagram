import { useState, useEffect, useRef } from "react";
import type { Message, ConnectionState, Degradation, DegradationCategory, AgentToolCall, AgentToolResult } from "../types";
import { io, Socket } from "socket.io-client";
import { useStore } from "../store/index";
import { useAuthStore } from "../store/auth";
import { supabase } from "../lib/supabase";
import { signOut } from "./useAuth";
import { diagramToJson } from "../ui/utils/diagramToJson";
import { persistCurrentDiagram } from "../lib/api";

// Render diferenciado por categoría (S6.9 P4): cada degradación se traduce a un
// aviso de chat legible. Fallback genérico para una categoría futura sin etiqueta.
const DEGRADATION_LABELS: Record<DegradationCategory, string> = {
    nodes: 'No se pudieron generar algunos elementos',
    edges: 'Faltan algunas relaciones que no se pudieron resolver',
    structure: 'El diagrama puede estar estructuralmente incompleto',
};

// Resumen legible de un refinamiento: describe QUÉ cambió (nodos/aristas
// añadidos, modificados, eliminados) en vez del genérico "Diagrama generado".
function refineSummary(c: {
    added: string[]; updated: string[]; deleted: string[];
    addedEdges: number; deletedEdges: number;
}): string {
    const parts: string[] = [];
    if (c.added.length) parts.push(`Añadidos nodos: ${c.added.join(', ')}`);
    if (c.updated.length) parts.push(`Modificados: ${c.updated.join(', ')}`);
    if (c.deleted.length) parts.push(`Eliminados nodos: ${c.deleted.join(', ')}`);
    if (c.addedEdges) parts.push(`${c.addedEdges} arista${c.addedEdges > 1 ? 's' : ''} nueva${c.addedEdges > 1 ? 's' : ''}`);
    if (c.deletedEdges) parts.push(`${c.deletedEdges} arista${c.deletedEdges > 1 ? 's' : ''} eliminada${c.deletedEdges > 1 ? 's' : ''}`);
    return parts.length ? parts.join(' · ') : 'Sin cambios en el diagrama';
}

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
        setGenerationPhase, clearDiagramContent,
    } = useStore();
    const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
    const socketRef = useRef<Socket | null>(null);
    // S9.3 — último prompt enviado, para guardarlo junto al diagrama (columna
    // prompt). Un ref: no debe provocar re-render ni recrear el efecto del socket.
    const lastPromptRef = useRef<string | undefined>(undefined);
    // El refinamiento NO pasa por staging/assembling: aplica deltas en vivo sobre
    // el canvas interactivo. Este ref distingue el run actual (refinamiento vs
    // generación) en el handler de `done`, donde ya no hay closure del prompt.
    const isRefiningRef = useRef(false);
    // Acumula los cambios del refinamiento en curso para componer el mensaje de
    // resumen ("Añadidos nodos…; Eliminado…") en lugar de "Diagrama generado".
    const refineChangesRef = useRef<{
        added: string[]; updated: string[]; deleted: string[];
        addedEdges: number; deletedEdges: number;
    }>({ added: [], updated: [], deleted: [], addedEdges: 0, deletedEdges: 0 });
    // S9.2 — el socket se (re)crea al cambiar la identidad (login/logout). El token
    // vigente se lee al conectar; los refrescos de token NO recrean el socket (la
    // verificación del backend ocurre solo en el handshake).
    const userId = useAuthStore((s) => s.user?.id ?? null);


    useEffect(() => {

        // S10.1 — la suscripción a los refrescos de token se limpia junto al socket.
        let authUnsub: (() => void) | undefined;

        try {
            const token = useAuthStore.getState().session?.access_token;
            socketRef.current = io('http://localhost:3001', {
                transports: ['websocket'],
                auth: token ? { token } : {},
            });
            const socket = socketRef.current;

            // S10.1 — supabase-js refresca el access token en segundo plano (mismo
            // usuario): se lo reenviamos al socket vivo para renovar su `exp` en el
            // backend SIN recrear la conexión (preserva la traza viva del agente).
            // Un cambio de identidad (login/logout) NO llega por aquí: recrea el
            // socket vía la dependencia `userId` de este efecto.
            const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
                if (event === 'TOKEN_REFRESHED' && session?.access_token) {
                    socket.emit('auth:refresh', session.access_token);
                }
            });
            authUnsub = () => authSub.subscription.unsubscribe();

            // S10.1 — el backend cortó la conexión por token caducado (o anomalía
            // de identidad): avisamos y deslogueamos para forzar un login limpio.
            socket.on('auth:expired', () => {
                addMessage({
                    id: crypto.randomUUID(),
                    text: 'Tu sesión ha expirado. Vuelve a iniciar sesión.',
                    sender: 'system',
                    timestamp: new Date(),
                });
                setUiState('error');
                void signOut();
            });

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
                    // Acumula el delta para el resumen del done. El label del
                    // borrado se lee ANTES de aplicar removeNode (luego ya no está).
                    const changes = refineChangesRef.current;
                    switch (data?.tool) {
                        case 'add_node':
                            if (data.node) { addNode(data.node); changes.added.push(data.node.label); }
                            break;
                        case 'update_node':
                            if (data.node) { updateNode(data.node.id, data.node); changes.updated.push(data.node.label); }
                            break;
                        case 'add_edge':
                            if (data.edge) { addEdge(data.edge); changes.addedEdges++; }
                            break;
                        case 'delete_node':
                            if (typeof result?.deleted_node === 'string') {
                                const id = result.deleted_node;
                                const label = useStore.getState().currentDiagram?.nodes.find((n) => n.id === id)?.label ?? id;
                                changes.deleted.push(label);
                                removeNode(id, Array.isArray(result.deleted_edges) ? result.deleted_edges : []);
                            }
                            break;
                        case 'delete_edge':
                            if (typeof result?.deleted_edge === 'string') {
                                removeEdge(result.deleted_edge);
                                changes.deletedEdges++;
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
                    text: isRefiningRef.current
                        ? `Diagrama actualizado — ${refineSummary(refineChangesRef.current)}`
                        : `Diagrama generado: ${data?.title ?? 'sin título'}`,
                    sender: 'system',
                    timestamp: new Date(),
                });
                // S9.3 — auto-guardado tras CADA done (generación y cada
                // refinamiento). persistCurrentDiagram es no-op si no hay sesión
                // ("login solo para guardar") y serializa POST→PATCH; fire-and-
                // forget para no bloquear la UI, solo se loguea el fallo.
                persistCurrentDiagram(lastPromptRef.current).then((r) => {
                    if (!r.ok && r.error !== 'no-session') {
                        console.error('[persist] auto-guardado falló:', r.error);
                    }
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
                // Refinamiento: no hubo staging ni fila almacén; el canvas ya mostró
                // los deltas en vivo. Saltamos la animación de ensamblaje y volvemos
                // directos a interactivo para no re-disparar un re-layout completo.
                if (isRefiningRef.current) {
                    isRefiningRef.current = false;
                    setGenerationPhase('done');
                    setUiState('ready');
                    return;
                }
                // Animación de ensamblaje: tras ~1 s de que se ve la fila completa en
                // el almacén, se dispara la transición a las posiciones de layout final.
                // El CSS de DiagramCanvas añade 'transition: transform 0.6s ease' a los
                // nodos React Flow SOLO durante 'assembling', de modo que el simple
                // cambio de posición se anima automáticamente.
                setGenerationPhase('assembling');
                setTimeout(() => {
                    setGenerationPhase('done');
                    setUiState('ready');
                }, 800);
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
                setGenerationPhase('idle');
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
            Promise.resolve().then(() => {
                setConnectionState('error');
                setUiState('error');
            });
            console.error("Failed to create WebSocket:", error);
        }

        return () => {
            authUnsub?.();
            if (socketRef.current) {
                socketRef.current.disconnect();
            }
        }
        // store actions (addEdge, addMessage, etc.) are stable Zustand references — safe to omit
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [url, userId]);

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
        lastPromptRef.current = text;

        const { currentDiagram, setCurrentDiagramId, setLastGenerationPrompt,
                selectedDiagramType, setLastGenerationType } = useStore.getState();
        if (currentDiagram) {
            // Refinamiento: el canvas permanece interactivo y recibe deltas en vivo
            // (sin pasar por la fila almacén de staging, que haría "desaparecer" el
            // diagrama). Reseteamos el acumulador de cambios para este run.
            isRefiningRef.current = true;
            refineChangesRef.current = { added: [], updated: [], deleted: [], addedEdges: 0, deletedEdges: 0 };
            socketRef.current?.emit('message:refine', {
                prompt: text,
                diagram: diagramToJson(currentDiagram),
            });
            setUiState('generating');
            return;
        } else {
            isRefiningRef.current = false;
            // S9.3 — generación desde cero: el diagrama resultante es nuevo, así
            // que su id persistido se resetea a null → el primer done hará POST.
            setCurrentDiagramId(null);
            // S9.3b — guarda el prompt que origina el diagrama → habilita "Regenerar".
            setLastGenerationPrompt(text);
            // S10.2 — tipo preseleccionado (o null = automático). Se recuerda para
            // que "Regenerar" conserve el mismo tipo. El campo viaja SOLO si hay
            // tipo: undefined ⇒ el agente clasifica (no inventamos un valor "auto").
            setLastGenerationType(selectedDiagramType);
            socketRef.current?.emit('message:send', {
                prompt: text,
                diagram_type: selectedDiagramType ?? undefined,
            });
        }
        setUiState('generating');
        setGenerationPhase('staging');
    };

    // S9.3b — Redo: regenera el prompt que originó el diagrama, IGNORANDO la
    // caché (el backend sobrescribe su entrada con el nuevo resultado). Solo tiene
    // sentido si ese prompt existe (diagrama generado en esta sesión).
    const regenerate = () => {
        const { lastGenerationPrompt: prompt, lastGenerationType } = useStore.getState();
        if (!prompt) return;
        addMessage({
            id: crypto.randomUUID(),
            text: 'Regenerando el diagrama…',
            sender: 'system',
            timestamp: new Date(),
        });
        clearToolTrace();
        lastPromptRef.current = prompt;
        isRefiningRef.current = false;
        // Limpiar el canvas ANTES de emitir: los nodos/aristas viejos desaparecen
        // inmediatamente; los nuevos poblarán el almacén desde cero vía staging.
        // El id/title/diagram_type de currentDiagram se conservan para que
        // applyDiagram reconcilie sobre el MISMO diagrama al llegar el done.
        clearDiagramContent();
        setUiState('generating');
        setGenerationPhase('staging');
        // S10.2 — conserva el tipo forzado del diagrama original (o auto si null).
        socketRef.current?.emit('message:regenerate', {
            prompt,
            diagram_type: lastGenerationType ?? undefined,
        });
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

    return {connectionState, sendMessage, sendClarificationAnswer, regenerate };
}

