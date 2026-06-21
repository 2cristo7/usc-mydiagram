import type { DiagramNode, DiagramEdge, DiagramSchema, DiagramType, UIState, Clarification, AgentToolCall, ToolTraceEntry, NodeOp, PendingTypeChoice, VersionMeta } from "../types";
import { create } from "zustand";
import { persistCurrentDiagram, renameDiagram } from "../lib/api";
import { toast } from "./toast";

// Fase de animación de generación por streaming.
// - 'idle': sin diagrama en curso, comportamiento normal.
// - 'live': los nodos/aristas van llegando y el diagrama se MONTA en tiempo real
//   (nube radial → cristalización dagre por cada arista). Ver liveLayout.ts.
// - 'done': montaje completado; canvas interactivo normal.
// Solo la generación por streaming pasa por 'live'. El refinamiento aplica deltas
// en vivo sobre el canvas interactivo (no toca generationPhase). Cargar un diagrama
// guardado va directamente a 'done'.
export type GenerationPhase = 'idle' | 'live' | 'done';

// Key del slot de borrador del diagrama nuevo/sin guardar (currentDiagramId === null).
// Los ids reales son UUID, así que este sentinel no colisiona con ninguno.
export const NEW_DRAFT_KEY = '__new__';

// Autoguardado con debounce: TODA edición manual del diagrama (renombrar nodos,
// añadir/borrar nodos y aristas, editar aristas, arrastrar, recalcular layout)
// persiste sola. Un único temporizador coalesce ráfagas: tras 800 ms sin cambios
// se dispara un guardado. No hay botón "Guardar"; el usuario nunca persiste a
// mano. (Los cambios de la IA persisten aparte, en el handler de diagram:done.)
let _saveTimer: ReturnType<typeof setTimeout> | null = null
function schedulePersist() {
    // Solo autoguarda la edición MANUAL (canvas interactivo). Las mismas acciones
    // (addNode, updateNode, removeEdge…) las dispara también el agente en streaming
    // (diagram:node_ready y deltas de refinamiento) con uiState='generating': ahí
    // NO queremos un POST a medias del diagrama — de eso ya se encarga el handler
    // de diagram:done una vez cerrado el run.
    if (useStore.getState().uiState !== 'ready') return
    if (_saveTimer !== null) clearTimeout(_saveTimer)
    // Una edición manual hace que el canvas DIVERJA de la última versión: el botón
    // "volver a esta versión" se habilita para todas las tarjetas (ya no estás en
    // ninguna) hasta que el guardado de debounce cree la versión manual_edit.
    if (useStore.getState().currentVersionSeq !== null) {
        useStore.setState({ currentVersionSeq: null })
    }
    _saveTimer = setTimeout(() => {
        _saveTimer = null
        // Marca el inicio del guardado (flag observable por la UI: "Guardando…").
        const { setSaving, setSaveError } = useStore.getState()
        setSaving(true)
        // Edición MANUAL → versión origin 'manual_edit' (navegable con ◀ ▶, no sale
        // en la lista de operaciones). La versión devuelta se añade al diario.
        // 'no-session' no es un fallo real (usuario sin login): se ignora en
        // silencio. El toast store deduplica mensajes idénticos simultáneos.
        persistCurrentDiagram({ origin: 'manual_edit' }).then((r) => {
            if (r.ok && r.version) {
                useStore.getState().addVersion(r.version)
                setSaveError(null)
            } else if (!r.ok && r.error !== 'no-session') {
                setSaveError(r.error ?? 'Error de guardado')
                toast.error('No se pudieron guardar los cambios. Revisa tu conexión.')
            } else {
                // Éxito sin versión nueva (p. ej. no-session): limpiamos el error previo.
                setSaveError(null)
            }
        // .catch defensivo: persistCurrentDiagram hoy nunca rechaza (atrapa en doSave),
        // pero no dependemos de ese invariante — si algún día rechaza, no dejamos el
        // flag `saving` pegado ni perdemos el error en silencio.
        }).catch((err: unknown) => {
            console.error('[persist] autoguardado rechazó:', err)
            setSaveError((err as Error)?.message ?? 'Error de guardado')
            toast.error('No se pudieron guardar los cambios. Revisa tu conexión.')
        }).finally(() => {
            setSaving(false)
        })
    }, 800)
}

interface MsgStore {
    // S10.3 — Diario de versiones (reemplaza el log de mensajes del chat). Es la
    // metadata de TODAS las versiones (agente + manuales), ordenada por seq. La
    // lista de operaciones se DERIVA filtrando origin != 'manual_edit'; la
    // navegación ◀ ▶ recorre la lista completa.
    versions: VersionMeta[];
    // Reemplaza el diario entero (al abrir un diagrama del historial).
    setVersions: (versions: VersionMeta[]) => void;
    // Añade una versión recién creada (tras un guardado) y se posiciona en el tip.
    addVersion: (version: VersionMeta) => void;
    // Comando del usuario EN VUELO (generación/refinamiento en curso). Se pinta
    // como tarjeta "en progreso" en el panel; al terminar se vuelve una versión.
    // null = no hay operación corriendo.
    activeOperation: string | null;
    setActiveOperation: (op: string | null) => void;
    // Borrador del input flotante POR DIAGRAMA (memoria de input, solo frontend).
    // Mapa keyed por currentDiagramId; el diagrama nuevo/sin guardar usa NEW_DRAFT_KEY.
    // Navegar entre diagramas conserva lo escrito-sin-enviar de cada uno; el slot del
    // diagrama solo se vacía al emitir su operación (sendMessage) y, si esa falla,
    // restoreFailedPrompt lo repone. Léelo con selectPromptDraft (resuelve la key).
    promptDrafts: Record<string, string>;
    // Escribe el borrador del DIAGRAMA ACTUAL (resuelve la key internamente).
    setPromptDraft: (v: string) => void;
    // seq de la versión cuyo estado coincide EXACTAMENTE con el canvas actual.
    // null = el canvas DIVERGE (se editó a mano y aún no coincide con ninguna
    // versión). Gobierna el botón "volver a esta versión": una tarjeta cuyo seq ==
    // currentVersionSeq está deshabilitada (ya estás en ella); al editar diverge.
    currentVersionSeq: number | null;
    // id de la versión sobre la que se asienta el canvas = PADRE de la próxima
    // versión que se cree (la posición en el árbol). A diferencia de
    // currentVersionSeq, NO se pone a null al divergir: una edición manual cuelga
    // su versión de aquí. Lo fija addVersion (al guardar) y goToVersion (al navegar).
    currentVersionId: string | null;
    // ANCLA DE ORDENACIÓN de la lista: la última versión del AGENTE creada (el
    // "head" del camino explorado). Solo cambia al crear una versión generate/refine
    // o al cargar; NO al navegar ni en ediciones manuales. Así la lista se reordena
    // (ramas muertas arriba) solo cuando refinas, no al moverte por el histórico.
    headVersionId: string | null;
    // Navegar a una versión EXISTENTE (botón "volver a esta versión"): pone el
    // canvas en su snapshot y mueve la posición del árbol ahí, SIN crear versión
    // nueva (el diario nunca pierde progreso; ramificar es trabajo de la siguiente
    // edición). Es navegación pura: no persiste.
    goToVersion: (version: VersionMeta, diagram: DiagramSchema) => void;
    // Contador que incrementa en cada goToVersion. El canvas lo observa para animar
    // la transición de nodos (glide a sus posiciones + entrada/salida) en vez de un
    // flash. No persiste; señal efímera (espejo de relayoutTick).
    navTick: number;
    // S10.x — petición de edición inline de un nodo desde fuera del componente
    // (menú contextual "Editar"). El nodo con este id arranca su edición y limpia
    // la petición. null = sin petición pendiente.
    editRequestNodeId: string | null;
    requestNodeEdit: (id: string | null) => void;
    // S10.3 — id del nodo en EDICIÓN INLINE de sus atributos (tabla ERD / iconos de
    // arquitectura): el nodo renderiza inputs para el nombre y las filas en su PROPIO
    // cuerpo (sin panel flotante), con añadir/eliminar fila. null = ninguno; solo uno
    // a la vez.
    editingNodeId: string | null;
    setEditingNodeId: (id: string | null) => void;
    uiState: UIState;
    setUiState: (state: MsgStore['uiState']) => void;
    // Fase de animación del streaming. Independiente de uiState para no
    // mezclar lógica de conexión con lógica de presentación de animación.
    generationPhase: GenerationPhase;
    setGenerationPhase: (phase: GenerationPhase) => void;
    // S7.4 — clarificación pendiente del agente (null si no hay ninguna)
    pendingClarification: Clarification | null;
    setPendingClarification: (c: Clarification | null) => void;
    // S10.3 — elección de tipo de diagrama UML ambiguo. Camino separado del flujo
    // de refine (pendingClarification/thread_id): se dispara por
    // `diagram:type_clarification` y se resuelve emitiendo `message:regenerate`.
    pendingTypeChoice: PendingTypeChoice | null;
    setPendingTypeChoice: (choice: PendingTypeChoice | null) => void;
    // S7.5 — traza en vivo de tool calls del run actual. Se limpia al lanzar un
    // run nuevo (sendMessage), NO al responder una clarificación: la reanudación
    // continúa el MISMO run y la traza sigue acumulando.
    toolTrace: ToolTraceEntry[];
    traceToolCall: (call: AgentToolCall) => void;
    traceToolResult: (id: string, status: 'ok' | 'error') => void;
    clearToolTrace: () => void;
    // S10.3 — operaciones por nodo del run EN VIVO (alta/edición/baja con el label
    // ya resuelto), para la lista que va "saliendo" en la tarjeta En curso. Distinta
    // de toolTrace (traza cruda: incluye find y usa los args de entrada del agente):
    // aquí solo nodos y con el nombre final. Se limpia al lanzar un run nuevo.
    liveOps: NodeOp[];
    pushLiveOp: (op: NodeOp) => void;
    clearLiveOps: () => void;
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
    // Tipo + título resueltos por el agente DURANTE el streaming (evento
    // diagram:type_ready), antes de que llegue el primer nodo. En modo automático
    // es la única forma de conocer el tipo a tiempo: sin él, el montaje en vivo
    // usaría el layout genérico y "flashearía" al tipo real en el done. El montaje
    // en vivo (addNode), el canvas y el header lo leen como fallback del
    // currentDiagram. Se limpia al arrancar/cerrar cada generación.
    streamingType: DiagramType | null;
    streamingTitle: string | null;
    setStreamingType: (type: DiagramType | null, title: string | null) => void;
    setCurrentDiagram: (diagram: DiagramSchema) => void;
    // Actualiza SOLO el título del diagrama vivo en memoria, sin persistir. Lo usa
    // el renombrado desde el historial para reflejar el cambio en el header cuando
    // el diagrama renombrado es justo el que está abierto (la persistencia ya la
    // hace el propio flujo del historial vía renameDiagram).
    setCurrentTitle: (title: string) => void;
    // Renombra el diagrama abierto: actualiza el título en memoria (el header
    // reacciona al instante) y persiste. Con id en BD → endpoint dedicado sin
    // crear versión; sin id (diagrama recién generado/importado aún sin guardar) →
    // schedulePersist, y el primer POST llevará ya el título nuevo.
    renameCurrentDiagram: (title: string) => void;
    updateNode(id: string, changes: Partial<DiagramNode>): void;
    // Persiste la posición del nodo tras un drag. Actualiza DiagramNode.position
    // en el store (nodes[] y currentDiagram.nodes[]) y dispara guardado en BD.
    updateNodePosition(id: string, position: { x: number; y: number }): void;
    // Persiste la geometría manual de un contenedor de GRUPO (arquitectura) tras
    // redimensionarlo/moverlo. Va a currentDiagram.group_layout y dispara guardado
    // en BD (versión manual_edit) → queda versionado y navegable, sobrevive recargas.
    setGroupGeometry(containerId: string, geom: { x: number; y: number; width: number; height: number }): void;
    // Migration path: EditableEdge uses this to persist inline label/type edits.
    // updates maps to Partial<DiagramEdge> (the domain type stored in edge data).
    updateEdge(edgeId: string, updates: Partial<DiagramEdge>): void;
    // S10.3 — reordena una arista a la posición `newIndex` del array de aristas
    // (índice de INSERCIÓN tras retirarla). En secuencia el orden del array ES el
    // eje temporal: mover un mensaje verticalmente equivale a reubicarlo aquí, y
    // sequenceLayout recalcula filas, fragmentos y activaciones de forma coherente.
    moveEdge(edgeId: string, newIndex: number): void;
    addNode: (node: DiagramNode) => void;
    addEdge: (edge: DiagramEdge) => void;
    // S7.5 — deltas del agente. El cascade de removeNode lo declara el SERVIDOR
    // (deleted_edges): aquí se aplica literal, sin reinferir qué aristas caen.
    removeNode: (id: string, edgeIds: string[]) => void;
    removeEdge: (id: string) => void;
    // Recalcular layout: descarta las posiciones manuales de los nodos y los
    // waypoints de las aristas para que DiagramToFlow (dagre/ELK/...) vuelva a
    // posicionar todo desde cero. Persiste el resultado.
    relayout: () => void;
    // S10.3 — contador que se incrementa en cada relayout(). El canvas lo observa
    // para activar una transición CSS temporal y que los nodos "vuelen" a sus
    // nuevas posiciones en vez de saltar (snap). No persiste; es señal efímera.
    relayoutTick: number;
    // S10.x — Importar un .mdia/.json: NO sobreescribe la sesión viva, arranca
    // una sesión limpia (canvas + chat vacíos, igual que newDiagram) y carga el
    // diagrama importado. currentDiagramId queda null → el guardado posterior es
    // un POST (fila NUEVA en BD), no un PATCH del diagrama que hubiera abierto.
    importDiagram: (diagram: DiagramSchema) => void;
    // S7.5 — reconciliación del done: aplica el snapshot completo SIEMPRE, con
    // guarda de idempotencia del render (no reemplazar estado React idéntico).
    applyDiagram: (diagram: DiagramSchema) => void;
    // Regenerar: vacía nodes/edges del canvas y de currentDiagram, conservando
    // id/title/diagram_type para que applyDiagram reconcilie sobre el MISMO
    // diagrama (no crea uno nuevo). No-op si no hay diagrama vivo.
    clearDiagramContent: () => void;
    // S10.x — "Nuevo diagrama": resetea el workspace al estado inicial en blanco
    // (canvas vacío + conversación vacía), como abrir un chat nuevo. NO toca la
    // BD: los diagramas guardados siguen en el historial; esto solo limpia el
    // estado vivo en memoria. El primer prompt tras esto arranca una generación
    // desde cero (currentDiagramId null → POST).
    newDiagram: () => void;
    // S10.3 — al eliminar (borrado suave) el diagrama ABIERTO desde el historial,
    // se vacía el canvas y se guarda aquí su id/título: el canvas muestra un aviso
    // "en la papelera, clica para restaurar". null = no hay diagrama en este
    // limbo. Restaurarlo (o cargar/crear otro) lo limpia; borrarlo en firme abre
    // un diagrama nuevo.
    trashedDiagram: { id: string; title: string } | null;
    markCurrentTrashed: (info: { id: string; title: string }) => void;
    clearTrashed: () => void;
    // Estado del autoguardado (schedulePersist). El autosave es fire-and-forget;
    // estos flags lo hacen OBSERVABLE para que la UI pueda mostrar "Guardando…" o un
    // aviso de fallo sin que cada componente reinvente el seguimiento.
    //   · saving    → hay una persistencia en curso (true al empezar, false al acabar).
    //   · saveError → mensaje del último fallo de guardado (null si el último fue ok).
    saving: boolean;
    saveError: string | null;
    setSaving: (saving: boolean) => void;
    setSaveError: (error: string | null) => void;
}

export type Store = MsgStore & DiagramStore;

// Borrador del input para el diagrama ACTUALMENTE abierto (memoria de input por
// diagrama). Devuelve el slot de currentDiagramId, o el del diagrama nuevo si null.
export const selectPromptDraft = (s: Store): string =>
    s.promptDrafts[s.currentDiagramId ?? NEW_DRAFT_KEY] ?? '';

export const useStore = create<Store>()((set) => ({

    versions: [],
    // Al cargar un diagrama, el canvas coincide con su última versión guardada (la
    // de mayor seq = el HEAD en BD), que es la posición de partida en el árbol.
    setVersions: (versions) => set({
        versions,
        currentVersionSeq: versions.at(-1)?.seq ?? null,
        currentVersionId: versions.at(-1)?.id ?? null,
        headVersionId: versions.at(-1)?.id ?? null,
    }),
    addVersion: (version) => set((state) => ({
        versions: [...state.versions, version],
        // El canvas pasa a coincidir EXACTAMENTE con la versión recién guardada, que
        // además es la nueva posición en el árbol (padre de la siguiente).
        currentVersionSeq: version.seq,
        currentVersionId: version.id,
        // El ancla de orden solo avanza con versiones del AGENTE: una edición manual
        // NO reordena la lista (mantiene el head anterior).
        headVersionId: version.origin === 'manual_edit' ? state.headVersionId : version.id,
    })),
    activeOperation: null,
    setActiveOperation: (op) => set({ activeOperation: op }),
    promptDrafts: {},
    setPromptDraft: (v) => set((s) => ({
        promptDrafts: { ...s.promptDrafts, [s.currentDiagramId ?? NEW_DRAFT_KEY]: v },
    })),
    currentVersionSeq: null,
    currentVersionId: null,
    headVersionId: null,
    goToVersion: (version, diagram) => set((state) => ({
        currentDiagram: diagram,
        nodes: diagram.nodes,
        edges: diagram.edges,
        currentVersionSeq: version.seq,
        currentVersionId: version.id,
        trashedDiagram: null,
        navTick: state.navTick + 1,
    })),
    navTick: 0,
    editRequestNodeId: null,
    requestNodeEdit: (id) => set({ editRequestNodeId: id }),
    editingNodeId: null,
    setEditingNodeId: (id) => set({ editingNodeId: id }),
    uiState: 'idle',
    setUiState: (state) => set({ uiState: state }),
    generationPhase: 'idle',
    setGenerationPhase: (phase) => set({ generationPhase: phase }),
    pendingClarification: null,
    setPendingClarification: (c) => set({ pendingClarification: c }),
    pendingTypeChoice: null,
    setPendingTypeChoice: (choice) => set({ pendingTypeChoice: choice }),

    toolTrace: [],
    traceToolCall: (call) => set((state) => ({
        toolTrace: [...state.toolTrace, { ...call, status: 'running' }],
    })),
    traceToolResult: (id, status) => set((state) => ({
        toolTrace: state.toolTrace.map((entry) => entry.id === id ? { ...entry, status } : entry),
    })),
    clearToolTrace: () => set({ toolTrace: [] }),

    liveOps: [],
    pushLiveOp: (op) => set((state) => ({ liveOps: [...state.liveOps, op] })),
    clearLiveOps: () => set({ liveOps: [] }),

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
    streamingType: null,
    streamingTitle: null,
    setStreamingType: (type, title) => set((state) => ({
        streamingType: type,
        streamingTitle: title,
        // Si los nodos ya empezaron a llegar (currentDiagram sembrado), aplicamos
        // el tipo/título al vuelo para que el layout en vivo cambie al correcto.
        currentDiagram: state.currentDiagram
            ? { ...state.currentDiagram, diagram_type: type ?? state.currentDiagram.diagram_type, title: title ?? state.currentDiagram.title }
            : state.currentDiagram,
    })),
    setCurrentDiagram: (diagram) => set({
        currentDiagram: diagram,
        nodes: diagram.nodes,
        edges: diagram.edges,
        trashedDiagram: null,
     }),
     setCurrentTitle: (title) => set((state) =>
        state.currentDiagram ? { currentDiagram: { ...state.currentDiagram, title } } : {}
     ),
     renameCurrentDiagram: (title) => {
        set((state) =>
            state.currentDiagram ? { currentDiagram: { ...state.currentDiagram, title } } : {}
        )
        const { currentDiagram, currentDiagramId } = useStore.getState()
        if (!currentDiagram) return
        if (currentDiagramId) {
            renameDiagram(currentDiagramId, title).catch(() => {
                toast.error('No se pudo renombrar el diagrama.')
            })
        } else {
            // Diagrama aún sin guardar: el autosave lo persistirá con el título nuevo.
            schedulePersist()
        }
     },
     updateNode: (id, changes) => {
        set((state) => ({
            nodes: state.nodes.map(node => node.id === id ? { ...node, ...changes } : node),
            currentDiagram: state.currentDiagram ? { ...state.currentDiagram, nodes: state.currentDiagram.nodes.map(node => node.id === id ? { ...node, ...changes } : node) } : null
        }))
        schedulePersist()
     },
     updateEdge: (edgeId, updates) => {
        set((state) => ({
            edges: state.edges.map(edge => edge.id === edgeId ? { ...edge, ...updates } : edge),
            currentDiagram: state.currentDiagram ? { ...state.currentDiagram, edges: state.currentDiagram.edges.map(edge => edge.id === edgeId ? { ...edge, ...updates } : edge) } : null,
        }))
        schedulePersist()
     },
     moveEdge: (edgeId, newIndex) => {
        set((state) => {
            const from = state.edges.findIndex((e) => e.id === edgeId)
            if (from === -1) return {}
            // `edges` y `currentDiagram.edges` se mantienen en el MISMO orden, así que
            // aplicamos la misma reubicación (from → newIndex) a ambos.
            const reorder = <T extends { id: string }>(arr: T[]): T[] => {
                const copy = arr.slice()
                const [moved] = copy.splice(from, 1)
                const to = Math.max(0, Math.min(newIndex, copy.length))
                copy.splice(to, 0, moved)
                return copy
            }
            const edges = reorder(state.edges)
            // No-op (soltar en el mismo slot): no tocar el store → sin re-layout ni
            // entrada de historial espuria.
            if (edges.every((e, i) => e.id === state.edges[i].id)) return {}
            return {
                edges,
                currentDiagram: state.currentDiagram
                    ? { ...state.currentDiagram, edges: reorder(state.currentDiagram.edges) }
                    : null,
            }
        })
        schedulePersist()
     },
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
     setGroupGeometry: (containerId, geom) => {
        set((state) => {
            if (!state.currentDiagram) return {}
            const group_layout = { ...(state.currentDiagram.group_layout ?? {}), [containerId]: geom }
            return { currentDiagram: { ...state.currentDiagram, group_layout } }
        })
        schedulePersist()
     },
     addNode: (node: DiagramNode) => {
        set((state) => {
            const updatedNodes = [...state.nodes, node]
            return {
                nodes: updatedNodes,
                currentDiagram: state.currentDiagram
                    ? { ...state.currentDiagram, nodes: updatedNodes }
                    // Primer nodo del streaming: sembramos el diagrama con el tipo/título
                    // ya resueltos por el agente (diagram:type_ready) si llegaron antes.
                    : { title: state.streamingTitle ?? '', diagram_type: state.streamingType, nodes: updatedNodes, edges: [] } as unknown as DiagramSchema,
            }
        })
        schedulePersist()
     },
     addEdge: (edge: DiagramEdge) => {
        set((state) => {
            const updatedEdges = [...state.edges, edge]
            return {
                edges: updatedEdges,
                currentDiagram: state.currentDiagram
                    ? { ...state.currentDiagram, edges: updatedEdges }
                    : { title: state.streamingTitle ?? '', diagram_type: state.streamingType, nodes: [], edges: updatedEdges } as unknown as DiagramSchema,
            }
        })
        schedulePersist()
     },
     removeNode: (id, edgeIds) => {
        set((state) => {
            const cascade = new Set(edgeIds)
            const nodes = state.nodes.filter((n) => n.id !== id)
            const edges = state.edges.filter((e) => !cascade.has(e.id))
            return {
                nodes,
                edges,
                currentDiagram: state.currentDiagram ? { ...state.currentDiagram, nodes, edges } : null,
            }
        })
        schedulePersist()
     },
     removeEdge: (id) => {
        set((state) => {
            const edges = state.edges.filter((e) => e.id !== id)
            return {
                edges,
                currentDiagram: state.currentDiagram ? { ...state.currentDiagram, edges } : null,
            }
        })
        schedulePersist()
     },
     relayout: () => {
        set((state) => {
            if (!state.currentDiagram) return {}
            // Quitamos position de cada nodo y waypoints de cada arista: sin esos
            // datos persistidos, DiagramToFlow recalcula el layout automático.
            const nodes = state.currentDiagram.nodes.map(({ position: _pos, ...node }) => node)
            const edges = state.currentDiagram.edges.map((edge) => {
                if (!edge.data?.waypoints) return edge
                const { waypoints: _wp, ...data } = edge.data
                return { ...edge, data }
            })
            // Recalcular descarta también la geometría manual de los grupos
            // (group_layout) para que el layout automático los redimensione.
            const { group_layout: _gl, ...rest } = state.currentDiagram
            return {
                nodes,
                edges,
                currentDiagram: { ...rest, nodes, edges },
                relayoutTick: state.relayoutTick + 1,
            }
        })
        schedulePersist()
     },
     relayoutTick: 0,
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
     newDiagram: () => set({
        nodes: [],
        edges: [],
        currentDiagram: null,
        currentDiagramId: null,
        lastGenerationPrompt: null,
        lastGenerationType: null,
        versions: [],
        currentVersionSeq: null,
        currentVersionId: null,
        headVersionId: null,
        activeOperation: null,
        toolTrace: [],
        pendingClarification: null,
        pendingTypeChoice: null,
        editRequestNodeId: null,
        editingNodeId: null,
        uiState: 'idle',
        generationPhase: 'idle',
        trashedDiagram: null,
     }),
     trashedDiagram: null,
     // Vacía el canvas y el chat pero deja el aviso de "en la papelera": idéntico a
     // newDiagram salvo que guarda info del diagrama para poder restaurarlo.
     markCurrentTrashed: (info) => set({
        nodes: [],
        edges: [],
        currentDiagram: null,
        currentDiagramId: null,
        lastGenerationPrompt: null,
        lastGenerationType: null,
        versions: [],
        currentVersionSeq: null,
        currentVersionId: null,
        headVersionId: null,
        activeOperation: null,
        toolTrace: [],
        pendingClarification: null,
        pendingTypeChoice: null,
        editRequestNodeId: null,
        editingNodeId: null,
        uiState: 'idle',
        generationPhase: 'idle',
        trashedDiagram: info,
     }),
     clearTrashed: () => set({ trashedDiagram: null }),
     saving: false,
     saveError: null,
     setSaving: (saving) => set({ saving }),
     setSaveError: (error) => set({ saveError: error }),
     importDiagram: (diagram) => set({
        nodes: diagram.nodes,
        edges: diagram.edges,
        currentDiagram: diagram,
        currentDiagramId: null,
        lastGenerationPrompt: null,
        lastGenerationType: null,
        versions: [],
        currentVersionSeq: null,
        currentVersionId: null,
        headVersionId: null,
        activeOperation: null,
        toolTrace: [],
        pendingClarification: null,
        pendingTypeChoice: null,
        editRequestNodeId: null,
        editingNodeId: null,
        uiState: 'ready',
        generationPhase: 'done',
        trashedDiagram: null,
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

