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
import { EmptyState, Spinner } from '../ui/primitives'

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
import { getDiagram, restoreDiagram, listVersions } from '../lib/api'
import { DiagramToFlow, computeDistributedAnchors, buildFlowEdges, type Box } from '../ui/utils/diagramToFlow'
import { liveLayout } from '../ui/utils/liveLayout'
import { useArchGeom, getArchTextSize } from '../store/archGeom'
import { archFootprintLocalBounds } from '../ui/utils/archBottle'

import { C4Node } from './nodes/C4Node'
import { ArchitectureNode } from './nodes/ArchitectureNode'
import { ArchIconNode } from './nodes/ArchIconNode'
import { ArchitectureGroupNode } from './nodes/ArchitectureGroupNode'
import { SequenceActorNode } from './nodes/SequenceActorNode'
import { SequenceFragmentNode } from './nodes/SequenceFragmentNode'
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
import { EdgeContextMenu } from './edges/EdgeContextMenu'
import { NodeContextMenu } from './nodes/NodeContextMenu'
import { persistCurrentDiagram } from '../lib/api'
import { toast } from '../store/toast'
import { beginHistoryInteraction, endHistoryInteraction } from '../store/historyManager'
import { beginDragCursor, endDragCursor } from '../ui/utils/dragCursor'
import { GRID_SIZE } from '../ui/utils/grid'
import { FIT_VIEW_OPTIONS, FIT_VIEW_OPTIONS_ANIMATED } from '../ui/utils/fitView'

const nodeTypes = {
  c4: C4Node,
  architecture: ArchitectureNode,
  archIcon: ArchIconNode,
  architectureGroup: ArchitectureGroupNode,
  sequenceActor: SequenceActorNode,
  sequenceFragment: SequenceFragmentNode,
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

// Duración de la animación de navegación entre versiones (ms). Debe coincidir con
// `.animate-nav` en index.css.
const NAV_ANIM_MS = 400

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
  const { currentDiagram, addNode, updateNodePosition, setGroupGeometry } = useStore()
  const uiState = useStore((s) => s.uiState)
  const generationPhase = useStore((s) => s.generationPhase)
  const trashedDiagram = useStore((s) => s.trashedDiagram)
  // Tipo preseleccionado/forzado: durante el montaje en vivo currentDiagram aún no
  // trae diagram_type (lo fija applyDiagram en el done), así que para que el layout
  // en vivo sea el REAL (mindmap radial, secuencia…) lo resolvemos igual que el
  // header: currentDiagram.diagram_type ?? preselección ?? tipo de la generación.
  const selectedDiagramType = useStore((s) => s.selectedDiagramType)
  const lastGenerationType = useStore((s) => s.lastGenerationType)
  const streamingType = useStore((s) => s.streamingType)
  const addEdge = useStore((s) => s.addEdge)
  const canvasLocked = useUiStore((s) => s.canvasLocked)
  const gridEnabled = useUiStore((s) => s.gridEnabled)
  const focusPrompt = useUiStore((s) => s.focusPrompt)
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
      try {
        s.setVersions(await listVersions(row.id))
      } catch {
        s.setVersions([])
      }
      useHistoryStore.getState().reset()
      s.setUiState('ready')
    } catch (e) {
      console.error('[DiagramCanvas] error restaurando diagrama de la papelera:', e)
      toast.error('No se pudo restaurar el diagrama de la papelera.')
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
  const { screenToFlowPosition, getNodes, getInternalNode, fitView } = useReactFlow()
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

  // Arrastre SOLO horizontal de los actores de secuencia: forzamos y=0 en cada
  // cambio de posición antes de aplicarlo, de modo que el nodo se mueva en vivo
  // pegado a la cabecera (antes solo se reajustaba al soltar). La lifeline y las
  // activaciones, al ser hijas del actor, lo siguen solas. Solo afecta a actores:
  // el redimensionado de fragmentos (que también emite cambios de posición) se
  // deja intacto.
  const handleNodesChange = useCallback<typeof onNodesChange>(
    (changes) => {
      if (currentDiagram?.diagram_type === 'sequence') {
        const actorIds = new Set(
          rfNodes.filter((n) => n.type === 'sequenceActor').map((n) => n.id),
        )
        changes = changes.map((c) =>
          c.type === 'position' && c.position && actorIds.has(c.id)
            ? { ...c, position: { ...c.position, y: 0 } }
            : c,
        )
      }
      onNodesChange(changes)
    },
    [onNodesChange, currentDiagram, rfNodes],
  )
  // Re-siembra del estado local al cambiar currentDiagram. EXCLUYE arquitectura:
  // su layout lo posee el efecto ELK (gated por estructura, más abajo). Re-sembrar
  // aquí el layout síncrono provisional en cada cambio de posición reposicionaría
  // los contenedores (cuya posición no se persiste) y haría "saltar" el diagrama
  // tras cada arrastre. El resto de tipos sí re-siembran siempre: DiagramToFlow
  // respeta node.position, así que reflejar undo/redo o ediciones de la IA es
  // idempotente y no produce saltos.
  // navTick incrementa al navegar a otra versión (goToVersion): distingue un cambio
  // de currentDiagram por NAVEGACIÓN (animar) de uno por edición normal (no animar).
  const navTick = useStore((s) => s.navTick)
  const navTickRef = useRef(0)
  const [animateNav, setAnimateNav] = useState(false)

  // Ventana de animación de navegación para TODOS los tipos (arquitectura incluida):
  // activa .animate-nav durante NAV_ANIM_MS para que las nuevas posiciones —vengan
  // de la re-siembra (no-arq) o del layout ELK (arq)— se animen en vez de saltar.
  useEffect(() => {
    if (navTick === 0) return
    setAnimateNav(true)
    const t = setTimeout(() => setAnimateNav(false), NAV_ANIM_MS + 50)
    return () => clearTimeout(t)
  }, [navTick])

  // Re-siembra de rfNodes desde currentDiagram (NO arquitectura: su layout lo posee
  // el efecto ELK de más abajo). En una NAVEGACIÓN etiqueta además la entrada/salida
  // de nodos para su fundido; cualquier otro cambio re-siembra directo.
  useEffect(() => {
    const isNav = navTick !== navTickRef.current
    navTickRef.current = navTick
    if (currentDiagram?.diagram_type === 'architecture') return
    if (!isNav) {
      setRfNodes(derived.nodes)
      setRfEdges(derived.edges)
      return
    }
    // Los nodos que PERSISTEN reciben sus nuevas posiciones y "vuelan" hasta ellas
    // (transición CSS de .animate-nav); los que APARECEN entran con fundido
    // (rf-enter); los que DESAPARECEN se mantienen un instante con fundido de salida
    // (rf-leave) y se retiran al cerrar la ventana.
    setRfNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]))
      const nextIds = new Set(derived.nodes.map((n) => n.id))
      const entering = derived.nodes.map((n) =>
        prevById.has(n.id) ? n : { ...n, className: `${n.className ?? ''} rf-enter`.trim() },
      )
      const leaving = prev
        .filter((n) => !nextIds.has(n.id))
        .map((n) => ({ ...n, className: `${n.className ?? ''} rf-leave`.trim(), draggable: false, selectable: false }))
      return [...entering, ...leaving]
    })
    setRfEdges(derived.edges)
    const t = setTimeout(() => {
      // Limpia las clases de entrada y descarta los nodos que salieron.
      setRfNodes(derived.nodes)
      setRfEdges(derived.edges)
    }, NAV_ANIM_MS + 50)
    return () => clearTimeout(t)
  }, [derived, currentDiagram, navTick, setRfNodes, setRfEdges])


  // Refinamiento del ruteo con tamaños MEDIDOS. El layout inicial (DiagramToFlow)
  // calcula anclajes/waypoints con tamaños ESTIMADOS de los nodos; al renderizar, el
  // tamaño real difiere y los anclajes "alineados" caen desfasados → escaloncitos.
  // Una vez React Flow mide los nodos, recalculamos el ruteo con sus cajas reales y
  // reconstruimos las aristas. Aplica a dagre, casos de uso y arquitectura (todos
  // enrutan con computeDistributedAnchors); se excluyen sequence (mensajes
  // posicionales) y mindmap (layout radial propio). La firma de geometría evita
  // recomputar salvo que cambie posición o tamaño de algún nodo.
  // Versión de la geometría de texto de los archIcon (cambia al medir/actualizar
  // el texto). El ruteo de arquitectura depende del footprint icono+texto.
  const archGeomVersion = useArchGeom((s) => s.version)
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
    if (dt === 'sequence' || dt === 'mindmap') return

    // Tipos de nodo que son contenedores (cajas que envuelven a otros): no deben
    // actuar como obstáculos del ruteo, y sus hijos viven anidados (posición
    // relativa al padre), así que usamos la posición ABSOLUTA del nodo interno.
    const CONTAINER_TYPES = new Set(['useCaseSystem', 'architectureGroup'])
    const containerIds = new Set<string>()
    // `boxes`: caja de la FORMA real del nodo (icono 72×72 en archIcon). Define dónde
    // se anclan los extremos → la flecha aterriza SOBRE el nodo, nunca en el margen
    // vacío junto al texto. `footprints`: caja completa icono+texto, usada SOLO como
    // obstáculo del ruteo para que las líneas rodeen el texto sin cruzarlo.
    const boxes = new Map<string, Box>()
    const footprints = new Map<string, Box>()
    for (const n of rfNodes) {
      const w = n.measured?.width
      const h = n.measured?.height
      if (!w || !h) return // aún no medidos: esperamos al siguiente cambio de firma
      // Posición absoluta (correcta también para hijos de un grupo de arquitectura).
      const abs = getInternalNode(n.id)?.internals.positionAbsolute ?? n.position
      const iconBox: Box = { cx: abs.x + w / 2, cy: abs.y + h / 2, w, h }
      boxes.set(n.id, iconBox)
      if (n.type === 'archIcon') {
        const { w: tw, h: th } = getArchTextSize(n.id)
        const b = archFootprintLocalBounds(tw, th)
        const fw = b.right - b.left
        const fh = b.bottom - b.top
        footprints.set(n.id, { cx: abs.x + b.left + fw / 2, cy: abs.y + b.top + fh / 2, w: fw, h: fh })
      } else {
        footprints.set(n.id, iconBox)
      }
      if (n.type && CONTAINER_TYPES.has(n.type)) containerIds.add(n.id)
    }
    if (boxes.size === 0) return

    const anchors = computeDistributedAnchors(currentDiagram, boxes, containerIds, footprints)
    setRfEdges(buildFlowEdges(currentDiagram, anchors))
    // nodeGeomSig resume la geometría de rfNodes; depender de él evita re-render en bucle.
    // archGeomVersion: el footprint de los archIcon depende del tamaño de su texto
    // (medido tras montar), así que re-rutear cuando cambie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeGeomSig, archGeomVersion, currentDiagram, setRfEdges, getInternalNode])

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

  // Re-encuadre continuo durante el montaje en vivo: la prop `fitView` solo encuadra
  // al montar, pero el diagrama CRECE mientras la cola de revelado lo va tejiendo.
  // Re-encuadramos ANIMADO en cada cambio de currentDiagram (cada tick de la cola):
  // la cámara "sigue" suavemente al diagrama según se ensambla en vez de saltar. Las
  // llamadas animadas se re-apuntan entre sí (d3-zoom), produciendo un seguimiento
  // continuo. Retardo de un frame para que React Flow haya aplicado los nodos nuevos.
  useEffect(() => {
    if (generationPhase !== 'live') return
    const t = setTimeout(() => fitView(FIT_VIEW_OPTIONS_ANIMATED), 0)
    return () => clearTimeout(t)
  }, [generationPhase, currentDiagram, fitView])

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

  // Layout de arquitectura: rejilla síncrona determinista. `derived` ya es
  // architectureLayoutSync(currentDiagram), función PURA de currentDiagram (incluye
  // group_layout y node.position), así que reconciliar rfNodes desde su salida
  // refleja TODO cambio —mover/redimensionar un contenedor, mover un hijo, undo/redo,
  // navegar a otra versión— sin casos especiales por tipo de cambio. (Las aristas las
  // recalcula el efecto de ruteo de más arriba desde las cajas medidas; aquí solo
  // posicionamos nodos.) El re-sembrado genérico de más arriba excluye arquitectura
  // a propósito: lo posee este efecto.
  useEffect(() => {
    if (currentDiagram?.diagram_type !== 'architecture' || generationPhase === 'live') return
    setRfNodes((prev) => {
      const next = derived.nodes
      // Misma ESTRUCTURA (mismos id+tipo+padre: un movimiento/redimensión/undo/
      // edición de etiqueta, no alta/baja ni cambio de tipo): parcheamos posición,
      // tamaño y data IN-PLACE conservando `measured` para no disparar re-medición
      // ni parpadeo de aristas. Si cambió la estructura, re-sembramos entero.
      const sig = (n: Node) => `${n.id}~${n.type ?? ''}~${n.parentId ?? ''}`
      const prevSigs = new Set(prev.map(sig))
      const sameStructure = prev.length === next.length && next.every((n) => prevSigs.has(sig(n)))
      if (!sameStructure) return next

      const byId = new Map(next.map((n) => [n.id, n]))
      let changed = false
      const patched = prev.map((n) => {
        const ln = byId.get(n.id)
        if (!ln) return n
        const posChanged = ln.position.x !== n.position.x || ln.position.y !== n.position.y
        const lw = (ln.style as { width?: number } | undefined)?.width
        const lh = (ln.style as { height?: number } | undefined)?.height
        const nw = (n.style as { width?: number } | undefined)?.width
        const nh = (n.style as { height?: number } | undefined)?.height
        const sizeChanged = lw !== nw || lh !== nh
        // data por VALOR (label + attributes): refleja renombrados/edición de la IA
        // sin re-sembrar. La comparación por valor mantiene el no-op estable (no
        // basta ===, derived crea data nuevo en cada cálculo).
        const ld = ln.data as { label?: string; attributes?: string[] }
        const nd = n.data as { label?: string; attributes?: string[] }
        const dataChanged =
          ld.label !== nd.label ||
          (ld.attributes ?? []).join('') !== (nd.attributes ?? []).join('')
        if (!posChanged && !sizeChanged && !dataChanged) return n
        changed = true
        return {
          ...n,
          position: ln.position,
          style: ln.style ? { ...n.style, ...ln.style } : n.style,
          data: dataChanged ? ln.data : n.data,
        }
      })
      return changed ? patched : prev
    })
  }, [derived, currentDiagram, generationPhase, setRfNodes])

  // ── FASE LIVE ───────────────────────────────────────────────────────────────
  // Montaje en tiempo real durante la generación por streaming. liveLayout coloca los
  // nodos que van llegando en un CÍRCULO RADIAL compacto y, según llegan las aristas,
  // cristaliza la estructura real (mindmap radial, ERD con dagre…) tirando de los nodos
  // conectados a su sitio; los aún sueltos esperan en un anillo. La cola de revelado de
  // useWebSocket marca el ritmo (un elemento cada ~190 ms+). La clase 'is-live' aplica
  // vía CSS la transición de transform, de modo que cada recálculo se ve como un glide.
  // El re-encuadre (cámara que sigue el montaje) lo lleva el efecto de más arriba.
  if (generationPhase === 'live' && currentDiagram) {
    // Resolver el tipo para el layout en vivo (ver arriba). Si lo conocemos y aún no
    // está en currentDiagram, se lo inyectamos para que liveLayout elija el layout real
    // (p. ej. mindmap radial) en vez del dagre genérico por defecto.
    // En auto, el tipo lo conocemos por el puente de streaming (diagram:type_ready)
    // antes que por selectedDiagramType/lastGenerationType (ambos null en auto).
    const liveType = currentDiagram.diagram_type ?? streamingType ?? selectedDiagramType ?? lastGenerationType
    const liveDiagram = liveType && !currentDiagram.diagram_type
      ? { ...currentDiagram, diagram_type: liveType }
      : currentDiagram
    const { nodes: liveNodes, edges: liveEdges } = liveLayout(liveDiagram)

    return (
      <div className="relative flex h-full w-full is-live">
        <EdgeMarkers />
        <ReactFlow
          nodes={liveNodes}
          edges={liveEdges}
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
            <Spinner size={48} label="Generando diagrama" />
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
        <EmptyState
          icon={<DiagramQuestionIcon size={48} />}
          title="Aún no hay ningún diagrama"
          description="Describe en lenguaje natural lo que quieres modelar (un ERD, un diagrama de clases, un flujo…) y la IA lo generará por ti."
          action={{ label: 'Escribir un diagrama', onClick: focusPrompt }}
        />
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
      // Contenedor de grupo de arquitectura: su geometría NO vive en
      // currentDiagram.nodes sino en group_layout, así que persistimos su nueva
      // posición ahí (conservando el tamaño actual). Sin esto, mover una caja se
      // perdía al re-sembrar y no lo capturaban ni el undo ni el autoguardado.
      if (n.type === 'architectureGroup') {
        const prev = currentDiagram?.group_layout?.[n.id]
        const width = prev?.width ?? n.measured?.width ?? n.width ?? 0
        const height = prev?.height ?? n.measured?.height ?? n.height ?? 0
        setGroupGeometry(n.id, { x: n.position.x, y: n.position.y, width, height })
        return
      }
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

  // Banner de error no intrusivo: visible cuando un refinamiento falla pero ya hay
  // un diagrama en el canvas (el bloque !currentDiagram no se alcanza en ese caso,
  // así que el usuario no vería nada sin este aviso). Se superpone en la franja
  // superior sin tapar el diagrama; desaparece al volver a 'ready' o 'generating'.
  const showErrorBanner = uiState === 'error'

  return (
    <div ref={canvasRef} className="relative flex h-full w-full">
      {showErrorBanner && (
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center gap-2 px-4 py-2 bg-[var(--color-surface)] border-b-[3px] border-[var(--color-danger)] shadow-[0_3px_0_var(--color-danger)] pointer-events-none">
          <AlertTriangle size={16} className="shrink-0 text-[var(--color-danger)]" />
          <p className="text-xs font-semibold text-[var(--color-ink)]">
            No se pudo completar la operación. Revisa el chat e inténtalo de nuevo.
          </p>
        </div>
      )}
      <EdgeMarkers />
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={handleNodesChange}
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
        className={`bg-[var(--color-bg)]${animateLayout ? ' animate-layout' : ''}${animateNav ? ' animate-nav' : ''}`}
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
      {currentDiagram.nodes.length === 0 && (
        // Diagrama cargado/creado pero sin nodos: el grid sigue visible debajo.
        // pointer-events-none deja pasar el arrastre desde la paleta al lienzo;
        // solo el CTA recupera los eventos.
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="pointer-events-auto">
            <EmptyState
              icon={<DiagramQuestionIcon size={48} />}
              title="Este diagrama está vacío"
              description="Arrastra un nodo desde la barra de la izquierda o pídele un cambio al chat para empezar a construirlo."
              action={{ label: 'Pedir un cambio al chat', onClick: focusPrompt }}
            />
          </div>
        </div>
      )}
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
