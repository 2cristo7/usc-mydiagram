import { useState, useEffect, useRef } from "react";
import type { ConnectionState, Degradation, DegradationCategory, AgentToolCall, AgentToolResult, DiagramNode, DiagramEdge } from "../types";
import { diagramSchema } from "../types";
import { io, Socket } from "socket.io-client";
import { useStore } from "../store/index";
import { useAuthStore } from "../store/auth";
import { supabase } from "../lib/supabase";
import { signOut } from "./useAuth";
import { diagramToJson } from "../ui/utils/diagramToJson";
import { persistCurrentDiagram } from "../lib/api";
import { toast } from "../store/toast";
import { useLlmSettingsStore } from "../store/llmSettings";
import { readTransientKey } from "../lib/transientLlmKey";

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

// ── Montaje en vivo: ritmo de la cola de revelado ───────────────────────────────
// El backend puede escupir todos los nodos/aristas en pocos ms; sin un ritmo propio
// veríamos un único snap (o una ráfaga ilegible). La cola libera UN elemento cada
// `step` ms en ORDEN DE LLEGADA, con `step` ADAPTATIVO: reparte lo pendiente en
// ~LIVE_TARGET_MS pero SIEMPRE deja un mínimo holgado entre elementos (LIVE_MIN_STEP)
// para que cada nodo/arista tenga tiempo de colocarse antes del siguiente.
const LIVE_TARGET_MS = 1500;
const LIVE_MIN_STEP = 45;
const LIVE_MAX_STEP = 120;
const clampLiveStep = (ms: number) => Math.max(LIVE_MIN_STEP, Math.min(LIVE_MAX_STEP, ms));

// Payload de `diagram:done` (campos que consume processDone; el resto se valida con
// diagramSchema antes de aplicarse).
type DoneData = {
    diagram?: { diagram_type?: unknown; nodes?: unknown[]; edges?: unknown[]; fragments?: unknown[] };
    title?: string;
    degraded?: boolean;
    degradations?: Degradation[];
};

export function useWebSocket(url: string = 'ws://localhost:3001') {
    const {
        addNode, addEdge, setUiState, setPendingClarification,
        updateNode, removeNode, removeEdge, applyDiagram,
        traceToolCall, traceToolResult, clearToolTrace,
        setGenerationPhase, clearDiagramContent, setPendingTypeChoice,
        addVersion, setActiveOperation, setStreamingType,
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
    // ── Cola de revelado del montaje en vivo (generación) ───────────────────────
    // Los nodos/aristas que llegan por streaming NO se aplican al canvas de inmediato:
    // entran a una única cola en ORDEN DE LLEGADA y la "bomba" (runLivePump) los revela
    // de uno en uno con ritmo. Así los nodos van apareciendo (liveLayout los coloca en
    // un círculo radial) y luego las aristas cristalizan la estructura poco a poco, sin
    // ráfaga. El `done` de la generación se aplaza (pendingDone) hasta vaciar la cola,
    // para no pisar el montaje con el snapshot completo de golpe.
    type RevealItem = { kind: 'node'; node: DiagramNode } | { kind: 'edge'; edge: DiagramEdge };
    const revealQueueRef = useRef<RevealItem[]>([]);
    const pumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const streamDoneRef = useRef(false);
    const pendingDoneRef = useRef<DoneData | null>(null);
    const liveActiveRef = useRef(false);

    // S9.2 — el socket se (re)crea al cambiar la identidad (login/logout). El token
    // vigente se lee al conectar; los refrescos de token NO recrean el socket (la
    // verificación del backend ocurre solo en el handshake).
    const userId = useAuthStore((s) => s.user?.id ?? null);

    // Timeout de generación: si el backend no emite diagram:done ni diagram:error
    // en 90 s (p. ej. el agente Python se cuelga), se limpia el estado y se avisa.
    const genTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Guard para el toast de connect_error: evita spamear el mismo aviso en cada
    // intento de reconexión consecutivo. Se resetea al conectar con éxito.
    const connectErrorToastedRef = useRef(false);

    // Arranca el temporizador de generación. Llámalo justo antes de setUiState('generating').
    // Si ya había uno pendiente (caso raro: doble emisión), lo cancela primero.
    const startGenTimeout = () => {
        if (genTimeoutRef.current) clearTimeout(genTimeoutRef.current);
        genTimeoutRef.current = setTimeout(() => {
            genTimeoutRef.current = null;
            resetLiveStream();
            setGenerationPhase('idle');
            setUiState('error');
            toast.error('La generación está tardando demasiado. Inténtalo de nuevo.');
        }, 90_000);
    };

    // Cancela el temporizador de generación (done, error, disconnect, clarification…).
    const cancelGenTimeout = () => {
        if (genTimeoutRef.current) {
            clearTimeout(genTimeoutRef.current);
            genTimeoutRef.current = null;
        }
    };

    // ── Bomba de la cola de revelado ────────────────────────────────────────────
    // Descarta cualquier montaje en vivo en curso (cancela timer, vacía colas y
    // resetea flags). Se llama al arrancar un run nuevo y en cualquier desenlace
    // (error, desconexión, timeout, desmontaje).
    const resetLiveStream = () => {
        if (pumpTimerRef.current != null) {
            clearTimeout(pumpTimerRef.current);
            pumpTimerRef.current = null;
        }
        revealQueueRef.current = [];
        streamDoneRef.current = false;
        pendingDoneRef.current = null;
        liveActiveRef.current = false;
        // El tipo/título del streaming pertenecen al run que se descarta.
        setStreamingType(null, null);
    };

    // Arranca un montaje en vivo limpio y entra en la fase 'live'.
    const startLiveStream = () => {
        resetLiveStream();
        liveActiveRef.current = true;
        setGenerationPhase('live');
    };

    // Programa la siguiente liberación si no hay ya una pendiente.
    const scheduleLivePump = (delay: number) => {
        if (pumpTimerRef.current != null) return;
        pumpTimerRef.current = setTimeout(runLivePump, delay);
    };

    // Revela UN elemento por tick en ORDEN DE LLEGADA. Para una arista exige que sus
    // dos extremos ya estén en el canvas (en orden de llegada lo normal es que el nodo
    // preceda a su arista; si no, se salta hacia delante hasta el primer elemento
    // revelable). Reprograma con ritmo holgado; al vaciarse, si el `done` ya llegó,
    // finaliza la generación.
    const runLivePump = () => {
        pumpTimerRef.current = null;
        if (!liveActiveRef.current) return;

        const q = revealQueueRef.current;
        if (q.length === 0) {
            if (streamDoneRef.current) finalizeGeneration();
            return;
        }

        const onCanvas = new Set(useStore.getState().currentDiagram?.nodes.map((n) => n.id) ?? []);
        const revealable = (it: RevealItem) =>
            it.kind === 'node' || (onCanvas.has(it.edge.source) && onCanvas.has(it.edge.target));

        // Primer elemento revelable. Si ninguno lo es (aristas cuyos nodos aún no han
        // llegado) y el stream sigue vivo, esperamos; si ya terminó, soltamos el frente.
        let idx = q.findIndex(revealable);
        if (idx < 0) {
            if (!streamDoneRef.current) {
                scheduleLivePump(LIVE_MAX_STEP);
                return;
            }
            idx = 0;
        }

        const [item] = q.splice(idx, 1);
        if (item.kind === 'node') addNode(item.node);
        else addEdge(item.edge);

        const remaining = q.length;
        if (remaining === 0) {
            if (streamDoneRef.current) finalizeGeneration();
            return;
        }
        scheduleLivePump(clampLiveStep(LIVE_TARGET_MS / remaining));
    };

    const enqueueLiveNode = (node: DiagramNode) => {
        revealQueueRef.current.push({ kind: 'node', node });
        scheduleLivePump(LIVE_MIN_STEP);
    };
    const enqueueLiveEdge = (edge: DiagramEdge) => {
        revealQueueRef.current.push({ kind: 'edge', edge });
        scheduleLivePump(LIVE_MIN_STEP);
    };

    // Aplica el desenlace del run: valida y reconcilia el snapshot, persiste como
    // versión y vuelve al canvas interactivo. Compartido por el refinamiento (canvas
    // ya interactivo) y la generación (tras drenar la cola del montaje en vivo).
    const processDone = (data: DoneData) => {
        if (data?.diagram) {
            // #7 — validar el snapshot con diagramSchema antes de aplicarlo. Si falla
            // (datos corruptos del backend) se avisa y NO se toca el canvas.
            const parseResult = diagramSchema.safeParse({
                title: data.title ?? '',
                diagram_type: data.diagram.diagram_type,
                nodes: data.diagram.nodes ?? [],
                edges: data.diagram.edges ?? [],
                // S10.4 — fragmentos combinados (solo secuencia; ausente en el resto,
                // el schema lo deja undefined y no contamina otros tipos).
                fragments: data.diagram.fragments,
            });
            if (!parseResult.success) {
                toast.error('El diagrama recibido no es válido.');
                setActiveOperation(null);
                setGenerationPhase('idle');
                setUiState('error');
                return;
            }
            const { currentDiagram } = useStore.getState();
            applyDiagram({
                title: data.title ?? currentDiagram?.title ?? '',
                diagram_type: parseResult.data.diagram_type,
                nodes: parseResult.data.nodes,
                edges: parseResult.data.edges,
                // S10.4 — fragmentos del snapshot. Si el agente no los devolvió en un
                // refinamiento (las tools aún no los reconstruyen), se conservan los
                // previos para no perderlos en una edición que no tocaba la estructura.
                fragments: parseResult.data.fragments?.length
                    ? parseResult.data.fragments
                    : currentDiagram?.fragments,
                // Conserva la geometría manual de los grupos a través del
                // refinamiento (el snapshot del agente no la trae).
                group_layout: currentDiagram?.group_layout,
            });
        }
        // S10.3 — el auto-guardado tras CADA done crea una VERSIÓN del diario
        // (POST/PATCH la devuelve). No-op sin sesión; fire-and-forget.
        const c = refineChangesRef.current;
        persistCurrentDiagram({
            prompt: lastPromptRef.current,
            origin: isRefiningRef.current ? 'refine' : 'generate',
            instruction: lastPromptRef.current ?? null,
            op_summary: {
                added: c.added,
                updated: c.updated,
                deleted: c.deleted,
                addedEdges: c.addedEdges,
                deletedEdges: c.deletedEdges,
            },
        }).then((r) => {
            if (r.ok && r.version) addVersion(r.version);
            else if (!r.ok && r.error !== 'no-session') {
                console.error('[persist] auto-guardado falló:', r.error);
            }
        });
        setActiveOperation(null);
        // Degradación parcial (S6.9): aviso por categoría, sin bloquear la UI.
        if (data?.degraded && Array.isArray(data.degradations)) {
            for (const text of degradationMessages(data.degradations)) {
                toast.warning(text);
            }
        }
        // Refinamiento: el canvas ya mostró los deltas en vivo. Generación: el
        // montaje en vivo ya ensambló el diagrama (mismas posiciones que el layout
        // final para tipos genéricos). En ambos casos pasamos directo a interactivo.
        isRefiningRef.current = false;
        setGenerationPhase('done');
        setUiState('ready');
    };

    // Cierra la generación una vez drenada la cola del montaje en vivo.
    const finalizeGeneration = () => {
        const data = pendingDoneRef.current;
        liveActiveRef.current = false;
        pendingDoneRef.current = null;
        streamDoneRef.current = false;
        // El done reconcilia el tipo/título definitivos en currentDiagram; el puente
        // de streaming ya cumplió su papel.
        setStreamingType(null, null);
        if (data) processDone(data);
    };

    useEffect(() => {

        // S10.1 — la suscripción a los refrescos de token se limpia junto al socket.
        let authUnsub: (() => void) | undefined;

        try {
            // #1 — URL configurable por entorno: VITE_WS_URL en producción / staging;
            // fallback a localhost para desarrollo local sin variable definida.
            const wsUrl = import.meta.env.VITE_WS_URL ?? 'http://localhost:3001';
            const token = useAuthStore.getState().session?.access_token;
            socketRef.current = io(wsUrl, {
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
                toast.error('Tu sesión ha expirado. Vuelve a iniciar sesión.');
                setActiveOperation(null);
                setUiState('error');
                void signOut();
            });

            socket.on('connect', () => {
                setConnectionState('connected');
                // #4 — nueva conexión exitosa: permitir de nuevo el toast de error
                // en la siguiente racha de fallos.
                connectErrorToastedRef.current = false;
                console.log("WebSocket connected");
                // S10.3b — Key transitoria: registramos el emisor para que el modal
                // de ajustes pueda empujar una key nueva al socket vivo, y
                // reenviamos la key ya guardada en sessionStorage (sobrevive a
                // recargas pero no al backend, que la perdió en la reconexión).
                useLlmSettingsStore.getState().registerTransientEmitter((payload) => {
                    if (socket.connected) socket.emit('llm:set_transient_key', payload);
                });
                const stored = readTransientKey();
                if (stored) socket.emit('llm:set_transient_key', { provider: stored.provider, api_key: stored.key });
            });

            // Montaje en vivo: los nodos/aristas NO se aplican al instante, se encolan
            // y la bomba (runLivePump) los libera con ritmo para que el diagrama se
            // monte en tiempo real (nube radial → cristalización dagre por arista).
            socket.on('diagram:node_ready', (node) => {
                enqueueLiveNode(node);
            });

            socket.on('diagram:edge_ready', (edge) => {
                enqueueLiveEdge(edge);
            });

            // S10.3 — el agente resolvió el tipo de diagrama (en classify, ANTES del
            // primer nodo). Lo guardamos para que el montaje en vivo use el layout
            // correcto desde el principio y el header muestre título+tipo, en vez de
            // montar genérico y "flashear" al tipo real en el done. Solo aplica a la
            // generación en vivo: el refinamiento no entra en fase 'live' y conserva
            // su propio tipo/título.
            socket.on('diagram:type_ready', (data: { diagram_type?: unknown; title?: unknown }) => {
                if (!liveActiveRef.current) return;
                const parsed = diagramSchema.shape.diagram_type.safeParse(data?.diagram_type);
                const type = parsed.success ? parsed.data : null;
                const title = typeof data?.title === 'string' ? data.title : null;
                setStreamingType(type, title);
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
                } else {
                    // #6 — la tool falló: avisamos con un warning no bloqueante.
                    // La traza visual ya marcará el paso como 'error'; el toast
                    // complementa con feedback visible en la esquina.
                    toast.warning('Una operación del agente falló durante el refinamiento.');
                }
                if (data?.id) traceToolResult(data.id, isError ? 'error' : 'ok');
            });

            socket.on('diagram:done', (data: DoneData) => {
                // #2 — desenlace válido: cancelar el timeout de generación.
                cancelGenTimeout();

                // Refinamiento (canvas ya interactivo) o generación cuyo montaje en
                // vivo ya terminó (o nunca arrancó): aplicamos el desenlace al instante.
                if (isRefiningRef.current || !liveActiveRef.current) {
                    processDone(data);
                    return;
                }

                // Generación aún montándose: NO aplicamos el snapshot ahora (taparía
                // el montaje en vivo de golpe). Lo guardamos y dejamos que la bomba
                // finalice cuando drene la cola. Si ya no queda nada por drenar y la
                // bomba está parada, finalizamos directamente.
                pendingDoneRef.current = data;
                streamDoneRef.current = true;
                if (pumpTimerRef.current == null && revealQueueRef.current.length === 0) {
                    finalizeGeneration();
                }
            });

            // S7.4 — el agente pausó pidiendo aclaración: la pregunta entra al
            // chat como mensaje del sistema y las opciones se muestran como
            // botones (ChatPanel lee pendingClarification del store). El input
            // queda habilitado para respuesta libre.
            socket.on('agent:clarification', (data) => {
                // #2 — desenlace válido: cancelar el timeout de generación.
                cancelGenTimeout();
                // La pregunta ya no es un "mensaje de chat": el panel la renderiza
                // desde pendingClarification (banner de aclaración pendiente).
                setPendingClarification({
                    thread_id: data?.thread_id,
                    question: data?.question ?? '',
                    options: Array.isArray(data?.options) ? data.options : [],
                });
                setUiState('awaiting_clarification');
            });

            // S10.3 — el backend detectó ambigüedad UML y pide al usuario que elija
            // el tipo de diagrama. Camino NUEVO, separado del flujo agent:clarification
            // (thread_id/resume). Se guarda la pregunta+opciones en pendingTypeChoice;
            // la respuesta va por `message:regenerate` (ver chooseDiagramType).
            socket.on('diagram:type_clarification', (data) => {
                // #2 — desenlace válido: cancelar el timeout de generación.
                cancelGenTimeout();
                const question: string = data?.question ?? '¿Qué tipo de diagrama quieres generar?';
                const options: { label: string; value: string }[] = Array.isArray(data?.options)
                    ? data.options
                    : [];
                // La pregunta de tipo la renderiza el panel desde pendingTypeChoice.
                setPendingTypeChoice({ question, options });
                setUiState('awaiting_clarification');
            });

            socket.on('diagram:error', (data) => {
                // #2 — desenlace válido (error explícito del backend): cancelar timeout.
                cancelGenTimeout();

                // Errores de LLM propagados por el agente: se muestran SOLO en el
                // banner rojo superior (AlertBanner, vía ollamaError del store), que
                // ya lleva su botón "Abrir configuración". El spinner se detiene
                // igual. No se añade mensaje al chat (sería redundante).
                if (data?.category === 'llm_error') {
                    useLlmSettingsStore.getState().setOllamaError({
                        error_code: 'llm_error',
                        detail: data.error ?? 'Error del modelo de lenguaje.',
                        provider: data.provider,
                    });
                    resetLiveStream();
                    setActiveOperation(null);
                    setGenerationPhase('idle');
                    setUiState('error');
                    return;
                }

                // Un error no es una operación → no va al diario; toast efímero.
                toast.error(data?.error ?? 'Error generando el diagrama');
                resetLiveStream();
                setActiveOperation(null);
                setGenerationPhase('idle');
                setUiState('error');
            });

            // Proxy del LLM en el navegador (transporte ollama-browser): el gateway
            // delega aquí la completion para que peguemos a NUESTRO Ollama local.
            // El navegador no distingue de forma fiable "Ollama apagado" de "CORS
            // bloqueado" (ambos lanzan TypeError) → un único error_code combinado.
            socket.on('llm:request', async (req: {
                request_id: string;
                model: string;
                messages: Array<{ role: string; content: string }>;
                options?: Record<string, unknown>;
                think?: boolean;
            }) => {
                const { request_id, model, messages, options, think } = req;
                const setOllamaError = useLlmSettingsStore.getState().setOllamaError;
                try {
                    const res = await fetch('http://localhost:11434/api/chat', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        // `think` se reenvía tal cual lo manda el agente: para modelos de
                        // razonamiento (qwen3) viaja `false`, si no el content vuelve vacío.
                        body: JSON.stringify({ model, messages, stream: false, think, options }),
                    });
                    if (!res.ok) {
                        const error_code = res.status === 404 ? 'model_missing' : 'unknown';
                        const detail = `Ollama respondió HTTP ${res.status}`;
                        setOllamaError({ error_code, detail, model });
                        socket.emit('llm:error', { request_id, error_code, detail, model });
                        return;
                    }
                    const data = await res.json();
                    // Fallback: si el modelo ignora think:false y emite <think>…</think>
                    // inline, nos quedamos con lo que va tras el cierre (igual que OllamaBackend).
                    let content: string = data?.message?.content ?? '';
                    if (content.includes('<think>') && content.includes('</think>')) {
                        content = content.split('</think>').pop()?.trim() ?? '';
                    }
                    setOllamaError(null);
                    socket.emit('llm:response', { request_id, content });
                } catch (err) {
                    const detail = (err as Error).message;
                    setOllamaError({ error_code: 'ollama_unreachable', detail, model });
                    socket.emit('llm:error', { request_id, error_code: 'ollama_unreachable', detail, model });
                }
            });

            socket.on('disconnect', (reason) => {
                setConnectionState('disconnected');
                console.log(`WebSocket disconnected — ${reason}`);
                // El cierre lo provocó el propio cliente (logout / cleanup del
                // efecto al cambiar de identidad): no es un fallo, no hay nada que
                // avisar ni que marcar como error.
                if (reason === 'io client disconnect') return;
                // Solo avisamos de "conexión perdida durante la generación" si
                // realmente había una generación en curso; una caída en reposo no
                // debe ensuciar el chat ni dejar el canvas en estado de error.
                if (useStore.getState().generationPhase === 'idle') return;
                // #2 — la desconexión interrumpió la generación: cancelar timeout
                // (evitar doble toast/reset si el timer ya disparó antes).
                cancelGenTimeout();
                // Caída de conexión: aviso efímero (toast), no una entrada del diario.
                toast.error('Conexión perdida durante la generación. Inténtalo de nuevo.');
                resetLiveStream();
                setActiveOperation(null);
                setGenerationPhase('idle');
                setUiState('error');
            });

            socket.on('connect_error', (error) => {
                setConnectionState('error');
                setUiState('error');
                console.error("WebSocket error:", error);
                // #4 — un solo toast por racha de fallos para no spamear al usuario.
                // connectErrorToastedRef se resetea en el handler 'connect' (éxito).
                if (!connectErrorToastedRef.current) {
                    connectErrorToastedRef.current = true;
                    toast.error('No se pudo conectar con el servidor.');
                }
            });
        } catch (error) {
            Promise.resolve().then(() => {
                setConnectionState('error');
                setUiState('error');
            });
            console.error("Failed to create WebSocket:", error);
        }

        return () => {
            // #2 — limpiar el timeout de generación al desmontar / recrear el socket.
            cancelGenTimeout();
            // Limpiar cualquier montaje en vivo en curso (timer de la bomba + colas).
            resetLiveStream();
            // S10.3b — el socket muere: el emisor transitorio ya no es válido.
            useLlmSettingsStore.getState().registerTransientEmitter(null);
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

        // El comando entra como operación EN VUELO (se pinta como tarjeta "en
        // progreso"); al terminar se materializa como versión del diario.
        setActiveOperation(text);

        // #3 — guard de conexión: si el socket no existe o está desconectado,
        // el emit se perdería en silencio y el spinner quedaría colgado.
        if (!socketRef.current?.connected) {
            toast.error('Sin conexión con el servidor. Reintenta en unos segundos.');
            setActiveOperation(null);
            return;
        }

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
            setUiState('generating');
            // #2 — arrancar timeout ANTES de emitir para cubrir cualquier cuelgue.
            startGenTimeout();
            socketRef.current.emit('message:refine', {
                prompt: text,
                diagram: diagramToJson(currentDiagram),
            });
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
            setUiState('generating');
            // Arranca el montaje en vivo (fase 'live' + cola de revelado limpia).
            startLiveStream();
            // #2 — arrancar timeout ANTES de emitir.
            startGenTimeout();
            socketRef.current.emit('message:send', {
                prompt: text,
                diagram_type: selectedDiagramType ?? undefined,
            });
        }
    };

    // S9.3b — Redo: regenera el prompt que originó el diagrama, IGNORANDO la
    // caché (el backend sobrescribe su entrada con el nuevo resultado). Solo tiene
    // sentido si ese prompt existe (diagrama generado en esta sesión).
    const regenerate = () => {
        const { lastGenerationPrompt: prompt, lastGenerationType } = useStore.getState();
        if (!prompt) return;

        // #3 — guard de conexión antes de cambiar cualquier estado de UI.
        if (!socketRef.current?.connected) {
            toast.error('Sin conexión con el servidor. Reintenta en unos segundos.');
            return;
        }

        setActiveOperation('Regenerar diagrama');
        clearToolTrace();
        lastPromptRef.current = prompt;
        isRefiningRef.current = false;
        // Limpiar el canvas ANTES de emitir: los nodos/aristas viejos desaparecen
        // inmediatamente; los nuevos montarán el diagrama desde cero en vivo.
        // El id/title/diagram_type de currentDiagram se conservan para que
        // applyDiagram reconcilie sobre el MISMO diagrama al llegar el done.
        clearDiagramContent();
        setUiState('generating');
        // Arranca el montaje en vivo (fase 'live' + cola de revelado limpia).
        startLiveStream();
        // #2 — arrancar timeout ANTES de emitir.
        startGenTimeout();
        // S10.2 — conserva el tipo forzado del diagrama original (o auto si null).
        socketRef.current.emit('message:regenerate', {
            prompt,
            diagram_type: lastGenerationType ?? undefined,
        });
    };

    // S7.4 — responder a la clarificación pendiente (botón u texto libre): la
    // respuesta viaja con el thread_id para reanudar ESA ejecución pausada.
    const sendClarificationAnswer = (answer: string) => {
        if (!answer.trim()) return;
        const { pendingClarification, setPendingClarification, setUiState } = useStore.getState();
        if (!pendingClarification) return;

        // #3 — guard de conexión: si el socket no está disponible, no entrar en
        // 'generating' (el botón de respuesta quedaría bloqueado indefinidamente).
        if (!socketRef.current?.connected) {
            toast.error('Sin conexión con el servidor. Reintenta en unos segundos.');
            return;
        }

        // La respuesta continúa la operación en vuelo (no es una entrada aparte).
        setPendingClarification(null);
        setUiState('generating');
        // #2 — arrancar timeout: la clarificación reanuda el agente, que puede
        // volver a colgarse igual que en la generación inicial.
        startGenTimeout();
        socketRef.current.emit('message:clarification_answer', {
            thread_id: pendingClarification.thread_id,
            answer,
        });
    };

    // S10.3 — el usuario eligió un tipo de diagrama tras `diagram:type_clarification`.
    // Re-lanza la generación con el prompt ORIGINAL (último mensaje de usuario) y el
    // tipo elegido, sin añadir un mensaje de usuario duplicado. Limpia la elección
    // pendiente y reactiva el estado de generación.
    const chooseDiagramType = (diagramTypeValue: string) => {
        const { setPendingTypeChoice, setSelectedDiagramType,
                setUiState, setLastGenerationType, setLastGenerationPrompt,
                setCurrentDiagramId, lastGenerationPrompt } = useStore.getState();

        // El prompt original es el último enviado (la generación que disparó la
        // pregunta de tipo). Ya no se rastrea por el log de mensajes.
        const originalPrompt = lastPromptRef.current ?? lastGenerationPrompt ?? undefined;
        if (!originalPrompt) return;

        // #3 — guard de conexión antes de entrar en 'generating'.
        if (!socketRef.current?.connected) {
            toast.error('Sin conexión con el servidor. Reintenta en unos segundos.');
            return;
        }

        // Actualizar tipo seleccionado en la UI para coherencia visual
        // (el valor viene como string; el store acepta DiagramType)
        setSelectedDiagramType(diagramTypeValue as import('../types').DiagramType);
        setLastGenerationType(diagramTypeValue as import('../types').DiagramType);
        setLastGenerationPrompt(originalPrompt);
        setCurrentDiagramId(null);

        // Limpiar la elección pendiente antes de emitir para que los botones
        // desaparezcan inmediatamente y no se pueda pulsar dos veces.
        setPendingTypeChoice(null);
        clearToolTrace();
        lastPromptRef.current = originalPrompt;
        isRefiningRef.current = false;

        // Limpiar el canvas: la nueva generación se monta en vivo desde cero.
        clearDiagramContent();
        setUiState('generating');
        // Arranca el montaje en vivo (fase 'live' + cola de revelado limpia).
        startLiveStream();
        // #2 — arrancar timeout ANTES de emitir.
        startGenTimeout();

        socketRef.current.emit('message:regenerate', {
            prompt: originalPrompt,
            diagram_type: diagramTypeValue,
        });
    };

    return {connectionState, sendMessage, sendClarificationAnswer, regenerate, chooseDiagramType };
}

