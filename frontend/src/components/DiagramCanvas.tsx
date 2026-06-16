import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DiagramEdge, DiagramNode, NodeType } from '../types'
import '@xyflow/react/dist/style.css'
import type { Connection, Edge, Node, OnNodeDrag } from '@xyflow/react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ConnectionMode,
} from '@xyflow/react'
import { AlertTriangle, Trash2 } from 'lucide-react'

function DiagramQuestionIcon({ size = 48, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* nodo superior */}
      <rect x="2" y="3" width="7" height="5" rx="1" />
      {/* nodo inferior */}
      <rect x="2" y="16" width="7" height="5" rx="1" />
      {/* conector del diagrama */}
      <path d="M5.5 8v8" />
      {/* interrogación */}
      <path d="M14 10.5a2.5 2.5 0 1 1 3.6 2.24c-.9.45-1.6 1.1-1.6 2.26" />
      <path d="M16 18.5h.01" />
    </svg>
  )
}
import { useStore } from '../store/index'
import { useUiStore } from '../store/ui'
import { useHistoryStore } from '../store/history'
import { getDiagram, restoreDiagram } from '../lib/api'
import { DiagramToFlow, computeDistributedAnchors, buildFlowEdges, type Box } from '../ui/utils/diagramToFlow'
import { stagingNodePositions, stagingEdges } from '../ui/utils/stagingLayout'

import { C4Node } from './nodes/C4Node'
import { ArchitectureNode } from './nodes/ArchitectureNode'
import { ArchitectureGroupNode } from './nodes/ArchitectureGroupNode'
import { SequenceActorNode } from './nodes/SequenceActorNode'
import { FlowNode } from './nodes/FlowNode'
import { TableNode } from './nodes/TableNode'
import { MindmapNode } from './nodes/MindmapNode'
import { LifelineNode } from './nodes/LifelineNode'
import { ActivationNode } from './nodes/ActivationNode'
import { UseCaseNode } from './nodes/UseCaseNode'
import { UseCaseActorNode } from './nodes/UseCaseActorNode'
import { UseCaseSystemNode } from './nodes/UseCaseSystemNode'
import { SequenceMessageEdge, EditableEdge, EdgeMarkers } from './edges'
import { makeConnectionLine } from './edges/ConnectionLine'
import { predictEdgeDefaults } from '../ui/utils/edgeDefaults'
import { architectureLayoutElk } from '../ui/utils/architectureLayout'
import { EdgeContextMenu } from './edges/EdgeContextMenu'
import { NodeContextMenu } from './nodes/NodeContextMenu'
import { persistCurrentDiagram } from '../lib/api'
import { beginHistoryInteraction, endHistoryInteraction } from '../store/historyManager'
import { beginDragCursor, endDragCursor } from '../ui/utils/dragCursor'
import { GRID_SIZE } from '../ui/utils/grid'
import { FIT_VIEW_OPTIONS, FIT_VIEW_OPTIONS_ANIMATED } from '../ui/utils/fitView'

const nodeTypes = {
  c4: C4Node,
  architecture: ArchitectureNode,
  architectureGroup: ArchitectureGroupNode,
  sequenceActor: SequenceActorNode,
  flow: FlowNode,
  table: TableNode,
  mindmap: MindmapNode,
  lifeline: LifelineNode,
  activation: ActivationNode,
  useCase: UseCaseNode,
  useCaseActor: UseCaseActorNode,
  useCaseSystem: UseCaseSystemNode,
}

// Un único modelo de edge editable (EditableEdge) para todos los diagramas: las
// variantes son solo de forma (recto/elbow/curvo) y de propiedades comunes
// (color, grosor, trazo, flechas). El mensaje de secuencia es la única excepción
// porque su geometría es posicional (altura cronológica), no una forma.
const edgeTypes = {
  sequenceMessage: SequenceMessageEdge,
  default: EditableEdge,
}

// Minimapa a mitad de tamaño (por defecto 200×150).
const MINIMAP_SIZE = { width: 100, height: 75 }

// Duración de la animación de "Recalcular layout" (ms). Debe coincidir con la
// transición CSS de `.animate-layout .react-flow__node` en index.css.
const LAYOUT_ANIM_MS = 400

// Modelo de ratón estilo Miro:
//  · Botón derecho (2) y rueda/central (1) arrastran el lienzo para navegar/pan
//    sobre el fondo (el central duplica al derecho). El derecho navega siempre,
//    también sobre nodos y aristas.
//  · Botón izquierdo: sobre el vacío arrastra una caja de selección múltiple
//    (selectionOnDrag, sin Shift); sobre un nodo lo arrastra/selecciona.
//  · Clic simple izquierdo sobre un nodo/arista no abre nada (solo lo selecciona);
//    el doble clic edita el texto in situ y el clic derecho abre el menú.
const PAN_ON_DRAG: number[] = [1, 2]
// Evita que el menú contextual nativo del navegador aparezca al hacer click derecho
// (su rol pasa a ser la navegación).
const suppressContextMenu = (e: React.MouseEvent) => e.preventDefault()

export function DiagramCanvas() {
  const { currentDiagram, addNode, updateNodePosition } = useStore()
  const uiState = useStore((s) => s.uiState)
  const generationPhase = useStore((s) => s.generationPhase)
  const trashedDiagram = useStore((s) => s.trashedDiagram)
  const streamingNodes = useStore((s) => s.nodes)
  const streamingEdges = useStore((s) => s.edges)
  const addEdge = useStore((s) => s.addEdge)
  const canvasLocked = useUiStore((s) => s.canvasLocked)
  const gridEnabled = useUiStore((s) => s.gridEnabled)
  const [, setSelectedNode] = useState<DiagramNode | null>(null)
  // Menús contextuales: se abren con click DERECHO (gesto tradicional de menú).
  // El derecho solo navega cuando arrastra (panOnDrag); un click derecho sin
  // movimiento dispara el context-menu y abre el panel de editar/eliminar. El
  // clic izquierdo simple no abre menú (solo selecciona); el doble clic edita.
  const [edgeMenu, setEdgeMenu] = useState<{ edgeId: string; x: number; y: number } | null>(null)
  const [nodeMenu, setNodeMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null)
  const closeEdgeMenu = useCallback(() => setEdgeMenu(null), [])
  const closeNodeMenu = useCallback(() => setNodeMenu(null), [])

  const openEdgeMenu = useCallback((event: React.MouseEvent, edge: Edge) => {
    setNodeMenu(null)
    setEdgeMenu({ edgeId: edge.id, x: event.clientX, y: event.clientY })
  }, [])
  const onEdgeContextMenu = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.preventDefault()
    openEdgeMenu(event, edge)
  }, [openEdgeMenu])

  const openNodeMenu = useCallback((event: React.MouseEvent, node: Node) => {
    const diagramNode = currentDiagram?.nodes.find((n) => n.id === node.id) ?? null
    setSelectedNode(diagramNode)
    setEdgeMenu(null)
    setNodeMenu({ nodeId: node.id, x: event.clientX, y: event.clientY })
  }, [currentDiagram])
  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault()
    openNodeMenu(event, node)
  }, [openNodeMenu])

  const isConnecting = useRef(false)
  const [, setConnectingTarget] = useState<string | null>(null)

  // Borrado de nodos (tecla Supr/Retroceso): React Flow quita el nodo de su estado
  // local, pero la verdad vive en el store (currentDiagram), que se re-siembra; hay
  // que reflejar el borrado allí (removeNode arrastra las aristas incidentes) y
  // persistir para que sobreviva a una recarga. Lectura fresca del store por si el
  // borrado afecta a varios nodos a la vez (selección múltiple).
  const onNodesDelete = useCallback((deleted: Node[]) => {
    const { edges, removeNode } = useStore.getState()
    deleted.forEach((n) => {
      const edgeIds = edges.filter((e) => e.source === n.id || e.target === n.id).map((e) => e.id)
      removeNode(n.id, edgeIds)
    })
    void persistCurrentDiagram()
  }, [])

  // Borrado de aristas por teclado (mismo motivo: reflejar en el store + persistir).
  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    const { removeEdge } = useStore.getState()
    deleted.forEach((e) => removeEdge(e.id))
    void persistCurrentDiagram()
  }, [])

  const onConnectStart = useCallback(() => {
    isConnecting.current = true
    setConnectingTarget(null)
  }, [])

  const onConnectEnd = useCallback(() => {
    isConnecting.current = false
    setConnectingTarget(null)
    document.querySelectorAll('.react-flow__node.snap-target').forEach((el) => {
      el.classList.remove('snap-target')
    })
  }, [])

  const onNodeMouseEnter = useCallback((_event: React.MouseEvent, node: Node) => {
    if (!isConnecting.current) return
    setConnectingTarget(node.id)
    document.querySelector(`.react-flow__node[data-id="${node.id}"]`)?.classList.add('snap-target')
  }, [])

  const onNodeMouseLeave = useCallback(() => {
    setConnectingTarget(null)
    document.querySelectorAll('.react-flow__node.snap-target').forEach((el) => {
      el.classList.remove('snap-target')
    })
  }, [])

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return
    // Como "solo hay un tipo de relación por diagrama", la arista nueva hereda
    // forma/tipo/estilo de las que ya existen (o el default por tipo si está
    // vacío), en vez de imponer siempre curva. Ver predictEdgeDefaults.
    const { shape, edge_type, strokeStyle, sourceArrow, targetArrow } =
      predictEdgeDefaults(useStore.getState().currentDiagram)
    addEdge({
      id: `e-${connection.source}-${connection.target}-${Date.now()}`,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle ?? undefined,
      targetHandle: connection.targetHandle ?? undefined,
      label: '',
      edge_type,
      data: { shape, strokeStyle, sourceArrow, targetArrow },
    } as DiagramEdge)
  }, [addEdge])

  // Restaurar el diagrama que quedó "en la papelera" al borrarlo abierto: lo saca
  // de la papelera en BD y lo recarga al canvas. setCurrentDiagram limpia el aviso.
  const restoreTrashed = useCallback(async () => {
    const info = useStore.getState().trashedDiagram
    if (!info) return
    try {
      await restoreDiagram(info.id)
      const row = await getDiagram(info.id)
      const s = useStore.getState()
      s.setCurrentDiagram(row.data)
      s.setCurrentDiagramId(row.id)
      s.setLastGenerationPrompt(row.prompt ?? null)
      s.setMessages(
        (row.messages ?? []).map((m) => ({ ...m, timestamp: new Date(m.timestamp) })),
      )
      useHistoryStore.getState().reset()
      s.setUiState('ready')
    } catch (e) {
      console.error('[DiagramCanvas] error restaurando diagrama de la papelera:', e)
    }
  }, [])

  // ── Guarda contra zoom-durante-navegación ───────────────────────────────────
  // El zoom (rueda) y la navegación (arrastre con botón central/derecho) son gestos
  // mutuamente excluyentes, pero el *momentum scroll* de macOS sigue emitiendo
  // eventos `wheel` de inercia un buen rato tras soltar la rueda —también con ratón
  // físico—. Si arrancas a navegar mientras esa inercia aún llega, d3-zoom toma esos
  // `wheel` como zoom y la vista "salta" en mitad del pan (el transform cambia de
  // escala solo, frame a frame). Solución: mientras haya un botón pulsado, tragamos
  // los `wheel` en FASE DE CAPTURA sobre el wrapper —antes de que el listener de
  // d3-zoom (en un descendiente, fase de burbuja) los vea— de modo que zoom y
  // navegación nunca se solapen. Callback ref para re-enganchar al cambiar de fase
  // (staging/assembling/done montan wrappers distintos).
  const wheelGuardCleanup = useRef<(() => void) | null>(null)
  const canvasRef = useCallback((el: HTMLDivElement | null) => {
    wheelGuardCleanup.current?.()
    wheelGuardCleanup.current = null
    if (!el) return
    let dragging = false
    const onDown = () => { dragging = true }
    const onUp = () => { dragging = false }
    const onWheel = (e: WheelEvent) => {
      if (dragging || e.buttons !== 0) e.stopPropagation()
    }
    el.addEventListener('mousedown', onDown, true)
    window.addEventListener('mouseup', onUp, true)
    el.addEventListener('wheel', onWheel, true)
    wheelGuardCleanup.current = () => {
      el.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('mouseup', onUp, true)
      el.removeEventListener('wheel', onWheel, true)
    }
  }, [])

  // ── Estado controlado del canvas interactivo ───────────────────────────────
  // React Flow v12 exige nodos/aristas controlados (con onNodesChange) para que
  // el arrastre siga al ratón en vivo. Derivamos del store via DiagramToFlow y
  // re-sembramos el estado local cada vez que cambia currentDiagram (nueva
  // generación, edición desde IA, persistencia de posición tras soltar).
  const { screenToFlowPosition, getNodes, fitView } = useReactFlow()
  const derived = useMemo(
    () => (currentDiagram ? DiagramToFlow(currentDiagram) : { nodes: [], edges: [] }),
    [currentDiagram],
  )
  // Línea de previsualización del arrastre con la forma nativa del diagrama
  // (la misma que tendrá la arista creada). Se recalcula al cambiar el diagrama.
  const connectionLineComponent = useMemo(
    () => makeConnectionLine(predictEdgeDefaults(currentDiagram).shape),
    [currentDiagram],
  )
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(derived.nodes)
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(derived.edges)
  useEffect(() => {
    setRfNodes(derived.nodes)
    setRfEdges(derived.edges)
  }, [derived, setRfNodes, setRfEdges])

  // Refinamiento del ruteo con tamaños MEDIDOS. El layout inicial (DiagramToFlow)
  // calcula anclajes/waypoints con tamaños ESTIMADOS de los nodos; al renderizar, el
  // tamaño real difiere y los anclajes "alineados" caen desfasados → escaloncitos.
  // Una vez React Flow mide los nodos, recalculamos el ruteo con sus cajas reales y
  // reconstruimos las aristas. Solo para diagramas que enrutan con dagre (no
  // sequence/mindmap/architecture, que tienen su propio layout). La firma de
  // geometría evita recomputar salvo que cambie posición o tamaño de algún nodo.
  const nodeGeomSig = useMemo(
    () =>
      rfNodes
        .map(
          (n) =>
            `${n.id}:${Math.round(n.position.x)},${Math.round(n.position.y)},${Math.round(
              n.measured?.width ?? 0,
            )},${Math.round(n.measured?.height ?? 0)}`,
        )
        .join('|'),
    [rfNodes],
  )
  useEffect(() => {
    if (!currentDiagram) return
    const dt = currentDiagram.diagram_type
    if (dt === 'sequence' || dt === 'mindmap' || dt === 'architecture' || dt === 'use_case') return

    const boxes = new Map<string, Box>()
    for (const n of rfNodes) {
      const w = n.measured?.width
      const h = n.measured?.height
      if (!w || !h) return // aún no medidos: esperamos al siguiente cambio de firma
      boxes.set(n.id, { cx: n.position.x + w / 2, cy: n.position.y + h / 2, w, h })
    }
    if (boxes.size === 0) return

    const anchors = computeDistributedAnchors(currentDiagram, boxes)
    setRfEdges(buildFlowEdges(currentDiagram, anchors))
    // nodeGeomSig resume la geometría de rfNodes; depender de él evita re-render en bucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeGeomSig, currentDiagram, setRfEdges])

  // Re-encuadre al CARGAR un diagrama distinto (p. ej. seleccionarlo en el
  // historial). El canvas interactivo ya está montado, y la prop `fitView` solo
  // encuadra una vez al montar; cargar otro diagrama cambia los nodos pero no
  // re-encuadra. Disparamos fitView imperativamente cuando cambia el id del
  // diagrama vivo. El refinamiento NO cambia el id, así que no re-encuadra (no
  // queremos mover la vista mientras el usuario edita).
  const currentDiagramId = useStore((s) => s.currentDiagramId)
  const lastFittedId = useRef<string | null>(null)
  useEffect(() => {
    if (!currentDiagramId || currentDiagramId === lastFittedId.current) return
    lastFittedId.current = currentDiagramId
    // Pequeño retardo para que los nodos del nuevo diagrama estén sembrados y
    // medidos antes de calcular el encuadre. Animado (duration): el diagrama
    // aparece en la vista anterior y "vuela" suavemente al encuadre nuevo, en
    // vez de dar un salto brusco (flash).
    const t = setTimeout(() => fitView(FIT_VIEW_OPTIONS_ANIMATED), 80)
    return () => clearTimeout(t)
  }, [currentDiagramId, fitView])

  // Animación del "Recalcular layout": al disparar relayout(), el store
  // incrementa relayoutTick. Activamos una clase que pone una transición CSS en
  // el transform de cada nodo, de modo que cuando setRfNodes aplica las nuevas
  // posiciones los nodos "vuelan" hasta ellas en vez de saltar. La quitamos al
  // acabar para no interferir con el arrastre normal.
  const relayoutTick = useStore((s) => s.relayoutTick)
  const [animateLayout, setAnimateLayout] = useState(false)
  useEffect(() => {
    if (relayoutTick === 0) return
    setAnimateLayout(true)
    const t = setTimeout(() => setAnimateLayout(false), LAYOUT_ANIM_MS + 50)
    return () => clearTimeout(t)
  }, [relayoutTick])

  // Refinamiento async ELK para diagramas de arquitectura.
  // El layout provisional síncrono (de useMemo) ya pintó algo; cuando ELK resuelve
  // sobrescribimos las posiciones con el resultado final, sin parpadeo perceptible.
  useEffect(() => {
    if (!currentDiagram || currentDiagram.diagram_type !== 'architecture') return
    if (generationPhase === 'staging' || generationPhase === 'assembling') return

    let cancelled = false
    architectureLayoutElk(currentDiagram).then(({ nodes: elkNodes, edges: elkEdges }) => {
      if (cancelled) return
      setRfNodes(elkNodes)
      setRfEdges(elkEdges)
    })

    return () => {
      cancelled = true
    }
  }, [currentDiagram, generationPhase, setRfNodes, setRfEdges])

  // ── FASE STAGING ────────────────────────────────────────────────────────────
  // Durante 'staging' mostramos el almacén: nodos en fila superior (reales, con
  // su tipo custom) y aristas nativas con etiqueta.
  // Nunca hay currentDiagram definitivo aquí (el snapshot llega en diagram:done).
  if (generationPhase === 'staging') {
    return (
      <div className="relative flex h-full w-full">
        {/* Banner informativo superpuesto */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 bg-[var(--color-surface)] border-[2px] border-[var(--color-ink)] shadow-[var(--shadow-brutal)] text-xs font-semibold text-[var(--color-ink)] pointer-events-none">
          Recibiendo elementos… ({streamingNodes.length} nodos · {streamingEdges.length} aristas)
        </div>
        <ReactFlow
          nodes={stagingNodePositions(streamingNodes)}
          edges={stagingEdges(streamingEdges)}
          fitView
          fitViewOptions={FIT_VIEW_OPTIONS}
          nodesDraggable={false}
          panOnDrag={PAN_ON_DRAG}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          onNodeMouseEnter={onNodeMouseEnter}
          onNodeMouseLeave={onNodeMouseLeave}
          onContextMenu={suppressContextMenu}
          className="bg-[var(--color-bg)]"
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            color="var(--color-ink)"
            gap={20}
            size={1}
            style={{ opacity: 0.12 }}
          />
        </ReactFlow>
      </div>
    )
  }

  // ── FASE ASSEMBLING ─────────────────────────────────────────────────────────
  // El snapshot final ya llegó (applyDiagram ya actualizó currentDiagram).
  // Calculamos el layout final y renderizamos con la clase 'is-assembling' en el
  // wrapper, que activa via CSS una transición de transform en los nodos React Flow.
  // React Flow verá que las posiciones cambiaron y animará el movimiento.
  if (generationPhase === 'assembling' && currentDiagram) {
    const { nodes: finalNodes, edges: finalEdges } = DiagramToFlow(currentDiagram)

    return (
      <div className="relative flex h-full w-full is-assembling">
        <EdgeMarkers />
        <ReactFlow
          nodes={finalNodes}
          edges={finalEdges}
          fitView
          fitViewOptions={FIT_VIEW_OPTIONS}
          nodesDraggable={false}
          panOnDrag={PAN_ON_DRAG}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          onNodeMouseEnter={onNodeMouseEnter}
          onNodeMouseLeave={onNodeMouseLeave}
          onContextMenu={suppressContextMenu}
          className="bg-[var(--color-bg)]"
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            color="var(--color-ink)"
            gap={20}
            size={1}
            style={{ opacity: 0.12 }}
          />
          <MiniMap
            className="border-[3px] border-[var(--color-ink)]"
            nodeColor="var(--color-accent)"
            style={{ background: 'var(--color-surface)', ...MINIMAP_SIZE }}
          />
        </ReactFlow>
      </div>
    )
  }

  // ── FASE DONE / IDLE ────────────────────────────────────────────────────────
  // Comportamiento normal: sin diagrama → estados vacíos; con diagrama → canvas
  // interactivo completo (drag, drop, propiedades).

  if (!currentDiagram) {
    if (trashedDiagram) {
      return (
        <div className="flex h-full w-full items-center justify-center bg-[var(--color-bg)]">
          <button
            onClick={restoreTrashed}
            className="max-w-sm border-[3px] border-[var(--color-ink)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-brutal)] text-center hover:bg-[var(--color-accent)]/10 active:translate-x-[2px] active:translate-y-[2px]"
          >
            <Trash2 size={32} className="mx-auto mb-2 text-[var(--color-ink)]/60" />
            <p className="text-sm font-semibold text-[var(--color-ink)]">
              Diagrama en la papelera, clica aquí para restaurarlo
            </p>
          </button>
        </div>
      )
    }
    if (uiState === 'generating') {
      return (
        <div className="flex h-full w-full items-center justify-center bg-[var(--color-bg)]">
          <div className="flex flex-col items-center gap-4">
            <div className="h-12 w-12 border-[4px] border-[var(--color-ink)] border-t-[var(--color-accent)] animate-spin" />
            <p className="text-sm font-semibold text-[var(--color-ink)]">
              Generando diagrama...
            </p>
          </div>
        </div>
      )
    }
    if (uiState === 'error') {
      return (
        <div className="flex h-full w-full items-center justify-center bg-[var(--color-bg)]">
          <div className="max-w-sm border-[3px] border-[var(--color-danger)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-brutal)] text-center">
            <AlertTriangle size={32} className="mx-auto mb-2 text-[var(--color-danger)]" />
            <p className="text-sm font-semibold text-[var(--color-ink)]">
              No se pudo generar el diagrama.
            </p>
            <p className="mt-1 text-xs text-[var(--color-ink)]/60">
              Revisa el chat e inténtalo de nuevo.
            </p>
          </div>
        </div>
      )
    }
    return (
      <div className="flex h-full w-full items-center justify-center bg-[var(--color-bg)]">
        <div className="flex flex-col items-center gap-3 text-center">
          <DiagramQuestionIcon size={48} className="text-[var(--color-ink)]/30" />
          <p className="text-sm font-semibold text-[var(--color-ink)]/60">
            Describe un diagrama en el chat para empezar
          </p>
        </div>
      </div>
    )
  }

  function onDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const nodeType = event.dataTransfer.getData('nodeType') as NodeType
    if (!nodeType) return
    const label = event.dataTransfer.getData('nodeLabel') || nodeType

    // Congela las posiciones renderizadas actuales para que dagre no reordene el
    // canvas al añadir el nodo (mismo criterio que la antigua NodePalette).
    getNodes().forEach((rfNode) => {
      const storeNode = currentDiagram?.nodes.find((n) => n.id === rfNode.id)
      if (storeNode && !storeNode.position) {
        updateNodePosition(rfNode.id, rfNode.position)
      }
    })

    // Traduce las coordenadas de pantalla del cursor a coordenadas de flujo.
    const dropped = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    // En secuencia los actores viven en la cabecera (y:0); solo respetamos X.
    const isSequence = currentDiagram?.diagram_type === 'sequence'
    const position = isSequence ? { x: dropped.x, y: 0 } : dropped

    const diagramNode: DiagramNode = {
      id: crypto.randomUUID(),
      label: `Nuevo ${label}`,
      node_type: nodeType,
      attributes: [],
      position,
    }
    addNode(diagramNode)
  }


  // Persiste la posición tras soltar un nodo.
  // Para diagramas de secuencia: los actores solo se mueven en X (su Y se fija
  // siempre en la cabecera = 0). Lifelines y activaciones no son arrastrables
  // (draggable:false en sequenceLayout), así que nunca llegan aquí.
  // Inicio del arrastre de un nodo: marca el comienzo del gesto para que el
  // historial capture una sola entrada (el estado previo) en vez de una por cada
  // posición intermedia.
  const onNodeDragStart: OnNodeDrag<Node> = () => {
    beginHistoryInteraction()
    // Bloquea el cursor en `grabbing` durante todo el arrastre: si el puntero
    // adelanta al nodo y cae sobre el pane, su `cursor: default !important` haría
    // parpadear el cursor entre agarre y normal (ver ui/utils/dragCursor.ts).
    beginDragCursor()
  }

  // React Flow dispara onNodeDragStop una sola vez al soltar, pero su tercer
  // argumento trae TODOS los nodos arrastrados (en selección múltiple se mueven
  // en bloque). Persistimos la posición de cada uno; si solo guardáramos `node`
  // (el que está bajo el cursor) los demás volverían a su sitio al re-sembrar.
  const onNodeDragStop: OnNodeDrag<Node> = (_event, node, nodes) => {
    const isSequence = currentDiagram?.diagram_type === 'sequence'
    const dragged = nodes && nodes.length > 0 ? nodes : [node]

    dragged.forEach((n) => {
      const diagramNode = currentDiagram?.nodes.find((d) => d.id === n.id)
      if (!diagramNode) return
      const x = n.position.x
      // En diagramas de secuencia los actores quedan siempre en y:0 (HEADER_H fija
      // la cabecera). Fijamos y=0 aquí para neutralizar cualquier deriva vertical.
      const y = isSequence && diagramNode.node_type === 'actor' ? 0 : n.position.y
      updateNodePosition(n.id, { x, y })
    })

    // Cierra el gesto: los cambios de posición ya se aplicaron dentro de la ventana
    // suspendida, así que queda una única entrada de historial.
    endHistoryInteraction()
    endDragCursor()
  }

  return (
    <div ref={canvasRef} className="relative flex h-full w-full">
      <EdgeMarkers />
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        nodesDraggable={!canvasLocked}
        nodesConnectable={!canvasLocked}
        elementsSelectable={!canvasLocked}
        panOnDrag={PAN_ON_DRAG}
        selectionOnDrag={!canvasLocked}
        snapToGrid={gridEnabled}
        snapGrid={[GRID_SIZE, GRID_SIZE]}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        deleteKeyCode={['Delete', 'Backspace']}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onContextMenu={suppressContextMenu}
        onPaneClick={() => { setSelectedNode(null); closeEdgeMenu(); closeNodeMenu() }}
        connectionMode={ConnectionMode.Loose}
        connectionLineComponent={connectionLineComponent}
        className={`bg-[var(--color-bg)]${animateLayout ? ' animate-layout' : ''}`}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={gridEnabled ? BackgroundVariant.Lines : BackgroundVariant.Dots}
          color="var(--color-ink)"
          gap={GRID_SIZE}
          size={1}
          style={{ opacity: gridEnabled ? 0.18 : 0.12 }}
        />
        <MiniMap
          className="border-[3px] border-[var(--color-ink)]"
          nodeColor="var(--color-accent)"
          style={{ background: 'var(--color-surface)', ...MINIMAP_SIZE }}
        />
      </ReactFlow>
      {edgeMenu && (
        <EdgeContextMenu
          edgeId={edgeMenu.edgeId}
          position={{ x: edgeMenu.x, y: edgeMenu.y }}
          onClose={closeEdgeMenu}
        />
      )}
      {nodeMenu && (
        <NodeContextMenu
          nodeId={nodeMenu.nodeId}
          position={{ x: nodeMenu.x, y: nodeMenu.y }}
          onClose={closeNodeMenu}
        />
      )}
    </div>
  )
}
