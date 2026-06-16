import { useCallback, useRef, useState } from 'react'
import {
  EdgeLabelRenderer,
  Position,
  useInternalNode,
  useReactFlow,
  useStoreApi,
} from '@xyflow/react'
import { useStore } from '../../store'
import { useUiStore } from '../../store/ui'
import { beginHistoryInteraction, endHistoryInteraction } from '../../store/historyManager'
import { beginDragCursor, endDragCursor } from '../../ui/utils/dragCursor'
import { getFloatingAnchor } from '../../ui/utils/getFloatingAnchor'
import { getAnchorPoint, projectToNodePerimeter, anchorToPosition } from '../../ui/utils/getNodeAnchor'
import { getElbowCorners } from '../../ui/utils/getWaypointPath'
import { projectOntoPath } from '../../ui/utils/getPathProjection'
import { snapPoint, snapValue } from '../../ui/utils/grid'
import type { EdgeVisualData } from '../../types'

type Point = { x: number; y: number }
type Axis = 'x' | 'y'

// Umbral (px de pantalla) para distinguir un clic de un arrastre.
const DRAG_THRESHOLD = 4
// Distancia (px de flujo) a la que el extremo "flasha" y se pega al punto medio
// de un lado del nodo.
const MIDPOINT_SNAP = 12
// Radio (px de PANTALLA) dentro del cual un tramo arrastrado se pega a la
// coordenada de otro vértice/extremo de la misma arista para quedar alineado.
// Evita los "escaloncitos" cuando no hay grid: dos tramos casi colineales se
// enderezan. Se mide en pantalla (se divide por el zoom) para sentirse igual a
// cualquier escala.
const ALIGN_SNAP_PX = 7

// Lógica de edición compartida por EditableEdge y ArchitectureEdge: calcula los
// extremos efectivos (anclaje fijo deslizado sobre el borde con prioridad sobre
// el punto por defecto, más snapping al grid), expone los waypoints y devuelve
// la capa de handles lista para pintar cuando la arista está seleccionada.
//
// Para aristas ortogonales (`segmentEditing`) el modelo de edición es por
// SEGMENTOS: una píldora en el centro de cada tramo lo desplaza perpendicular a
// su orientación (los tramos pegados a un nodo insertan un codo/stub para no
// despegar el extremo), y un doble clic sobre la línea crea una esquina. Para el
// resto de formas se conservan los handles clásicos de waypoint/midpoint.
export function useEdgeEditing(args: {
  id: string
  source: string
  target: string
  data: EdgeVisualData
  selected?: boolean
  // Extremos por defecto cuando no hay anclaje fijo: EditableEdge pasa su
  // anclaje flotante; ArchitectureEdge pasa la posición del handle (ELK).
  defaultSrcPt: Point
  defaultTgtPt: Point
  // Si la arista muestra etiqueta (la "tarjeta"), su posición a lo largo del
  // trazado (labelT en [0..1]).
  hasLabel?: boolean
  labelT?: number
  // Edición por segmentos (píldoras + doble clic). Solo aristas ortogonales con
  // ruta elbow real (EditableEdge shape 'elbow', ArchitectureEdge).
  segmentEditing?: boolean
  // Dirección de salida/entrada del nodo (solo ArchitectureEdge). Permite que la
  // ruta por defecto SIN waypoints salga perpendicular al borde (ruta por el
  // centro estilo smoothstep) en vez del codo en L horizontal-primero.
  sourcePosition?: Position
  targetPosition?: Position
}) {
  const { id, source, target, data, selected, defaultSrcPt, defaultTgtPt, hasLabel, labelT, segmentEditing } = args
  const waypoints = data.waypoints ?? []
  const sourceAnchor = data.sourceAnchor
  const targetAnchor = data.targetAnchor

  const updateEdge = useStore((s) => s.updateEdge)
  const gridEnabled = useUiStore((s) => s.gridEnabled)
  const { screenToFlowPosition } = useReactFlow()
  const storeApi = useStoreApi()
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)

  // El anclaje fijo (deslizado por el usuario sobre el borde) tiene prioridad
  // sobre el extremo por defecto. Un anclaje fijo NO se snappea (lo apartaría
  // del borde del nodo).
  const srcPt = sourceAnchor && sourceNode
    ? getAnchorPoint(sourceNode as never, sourceAnchor)
    : defaultSrcPt
  const tgtPt = targetAnchor && targetNode
    ? getAnchorPoint(targetNode as never, targetAnchor)
    : defaultTgtPt

  const srcPositionOverride: Position | undefined = sourceAnchor ? anchorToPosition(sourceAnchor) : undefined
  const tgtPositionOverride: Position | undefined = targetAnchor ? anchorToPosition(targetAnchor) : undefined

  // Lado efectivo de salida/entrada. Prioridad: anclaje fijo del usuario > lado
  // por props (ArchitectureEdge, vía ELK) > lado derivado del propio extremo
  // (EditableEdge: el punto borde-borde flotante se proyecta al lado más cercano).
  // Con un lado conocido el extremo abandona el nodo perpendicular (codo/stub),
  // tanto en la ruta por defecto como con waypoints intermedios.
  const effectiveSrcPos =
    srcPositionOverride ?? args.sourcePosition ?? sideOfPoint(sourceNode, srcPt)
  const effectiveTgtPos =
    tgtPositionOverride ?? args.targetPosition ?? sideOfPoint(targetNode, tgtPt)

  // Refs para que los listeners window-level lean estado actual sin recrearse.
  const sourceRef = useRef(source)
  sourceRef.current = source
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const targetRef = useRef(target)
  targetRef.current = target
  const waypointsRef = useRef(waypoints)
  waypointsRef.current = waypoints
  const dataRef = useRef(data)
  dataRef.current = data
  const gridEnabledRef = useRef(gridEnabled)
  gridEnabledRef.current = gridEnabled
  const labelTRef = useRef(labelT ?? 0.5)
  labelTRef.current = labelT ?? 0.5
  const draggingIndexRef = useRef<number | null>(null)
  // Posición actual de cada extremo: la leen los handlers de arrastre.
  const srcPtRef = useRef(srcPt)
  srcPtRef.current = srcPt
  const tgtPtRef = useRef(tgtPt)
  tgtPtRef.current = tgtPt
  const srcPosRef = useRef(effectiveSrcPos)
  srcPosRef.current = effectiveSrcPos
  const tgtPosRef = useRef(effectiveTgtPos)
  tgtPosRef.current = effectiveTgtPos

  // Esquinas ortogonales efectivas (vértices renderizados). Respeta la dirección
  // de salida en la ruta por defecto. Es la fuente de verdad para píldoras y
  // arrastre de segmentos. cornersFromRefs() es la versión que leen los listeners.
  const computeCorners = (s: Point, t: Point, wps: Point[]): Point[] =>
    routeCorners(s, t, wps, srcPosRef.current, tgtPosRef.current)
  const cornersFromRefs = (): Point[] =>
    computeCorners(srcPtRef.current, tgtPtRef.current, waypointsRef.current)

  const [isDragging, setIsDragging] = useState(false)
  const [anchorDragging, setAnchorDragging] = useState<'source' | 'target' | null>(null)
  const [anchorCursor, setAnchorCursor] = useState<Point | null>(null)
  const [anchorSnappedPt, setAnchorSnappedPt] = useState<Point | null>(null)
  const [anchorFlash, setAnchorFlash] = useState(false)

  // ---------------------------------------------------------------------------
  // Edición por SEGMENTOS (aristas ortogonales)
  // ---------------------------------------------------------------------------

  // Arrastre de un segmento. Dos modos:
  //  - 'bend' (píldora del medio): mueve el tramo perpendicular a su orientación.
  //    Los centrales deslizan sus dos esquinas; los pegados a un nodo doblan desde
  //    el centro (planSegmentDrag) manteniendo fijo el punto de unión.
  //  - 'slide' (punto de unión, solo tramos pegados a un nodo): traslada el tramo
  //    ENTERO deslizando el anclaje por el borde del nodo, sin partirlo ni doblar.
  // La primera vez que se supera el umbral materializa la ruta y a partir de ahí
  // arrastra.
  const beginSegmentDrag = useCallback(
    (segIndex: number, startClientX: number, startClientY: number) => {
      let inserted = false
      let idxA = -1
      let idxB = -1
      let axis: Axis = 'y'
      // Array de trabajo del gesto. NO leemos waypointsRef en cada move: ese ref
      // solo se refresca al re-renderizar, así que un pointermove que llega antes
      // del render leería los waypoints viejos (vacíos en una arista recién
      // doblada) y sobrescribiría el store → la arista vuelve a recta ("no dobla").
      let wps: Point[] = []
      // Coordenadas (en el eje que se mueve) de los demás vértices/extremos de la
      // arista: a ellas se pega el tramo para alinearse. Se rellena al materializar
      // el gesto (cuando ya se conoce `axis`).
      let alignTargets: number[] = []
      const snapAxis = (v: number) => {
        const g = gridEnabledRef.current ? snapValue(v) : v
        if (!alignTargets.length) return g
        return snapToAlignment(g, alignTargets, ALIGN_SNAP_PX / (storeApi.getState().transform[2] || 1))
      }

      const onMove = (ev: PointerEvent) => {
        const flowPos = screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
        if (!inserted) {
          if (Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY) < DRAG_THRESHOLD) return
          const corners = cornersFromRefs()
          const L = corners.length
          if (segIndex >= L - 1) return
          axis = segPerpAxis(corners[segIndex], corners[segIndex + 1])
          // Vértices contra los que alinear: todos menos los dos extremos del
          // propio tramo (alinear con uno mismo no aporta nada).
          alignTargets = corners
            .filter((_, i) => i !== segIndex && i !== segIndex + 1)
            .map((p) => p[axis])
          inserted = true
          setIsDragging(true)
          beginDragCursor()
          beginHistoryInteraction()
          const val = snapAxis(axis === 'x' ? flowPos.x : flowPos.y)
          const plan = planSegmentDrag(corners, segIndex, axis, val)
          idxA = plan.idxA
          idxB = plan.idxB
          wps = plan.waypoints
          updateEdge(id, { data: { ...dataRef.current, waypoints: wps } } as never)
          return
        }
        const val = snapAxis(axis === 'x' ? flowPos.x : flowPos.y)
        wps = wps.map((p) => ({ ...p }))
        if (wps[idxA]) wps[idxA][axis] = val
        if (wps[idxB]) wps[idxB][axis] = val
        updateEdge(id, { data: { ...dataRef.current, waypoints: wps } } as never)
      }

      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        setIsDragging(false)
        endDragCursor()
        if (!inserted) return
        // Normaliza: re-deriva las esquinas para colapsar stubs degenerados y
        // vértices colineales acumulados durante el arrastre.
        const corners = computeCorners(srcPtRef.current, tgtPtRef.current, wps)
        const interior = corners.slice(1, -1)
        if (interior.length !== wps.length) {
          updateEdge(id, { data: { ...dataRef.current, waypoints: interior } } as never)
        }
        endHistoryInteraction()
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [id, updateEdge, screenToFlowPosition]
  )

  const handleSegmentPointerDown = useCallback(
    (e: React.PointerEvent, segIndex: number) => {
      e.stopPropagation()
      beginSegmentDrag(segIndex, e.clientX, e.clientY)
    },
    [beginSegmentDrag]
  )

  // Doble clic sobre la línea → inserta una esquina nueva en el punto pulsado.
  const handlePathDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const snapped = gridEnabledRef.current ? snapPoint(flowPos) : flowPos
      const allPts = [srcPtRef.current, ...waypointsRef.current, tgtPtRef.current]
      const insertIndex = nearestSegmentIndex(allPts, flowPos)
      const newWaypoints = [...waypointsRef.current]
      newWaypoints.splice(insertIndex, 0, snapped)
      beginHistoryInteraction()
      updateEdge(id, { data: { ...dataRef.current, waypoints: newWaypoints } } as never)
      endHistoryInteraction()
    },
    [id, updateEdge, screenToFlowPosition]
  )

  // ---------------------------------------------------------------------------
  // Handles clásicos (waypoint/midpoint) para formas no ortogonales
  // ---------------------------------------------------------------------------

  const startWaypointDrag = useCallback(
    (index: number) => {
      draggingIndexRef.current = index
      setIsDragging(true)
      beginDragCursor()

      const onMove = (e: PointerEvent) => {
        const idx = draggingIndexRef.current
        if (idx === null) return
        const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
        const newWaypoints = [...waypointsRef.current]
        newWaypoints[idx] = gridEnabledRef.current ? snapPoint(flowPos) : flowPos
        beginHistoryInteraction()
        updateEdge(id, { data: { ...dataRef.current, waypoints: newWaypoints } } as never)
      }

      const onUp = () => {
        draggingIndexRef.current = null
        setIsDragging(false)
        endDragCursor()
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        endHistoryInteraction()
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [id, updateEdge, screenToFlowPosition]
  )

  const handleWaypointPointerDown = useCallback(
    (e: React.PointerEvent, index: number) => {
      e.stopPropagation()
      startWaypointDrag(index)
    },
    [startWaypointDrag]
  )

  const handleWaypointDoubleClick = useCallback(
    (e: React.MouseEvent, index: number) => {
      e.stopPropagation()
      const newWaypoints = waypointsRef.current.filter((_, i) => i !== index)
      beginHistoryInteraction()
      updateEdge(id, { data: { ...dataRef.current, waypoints: newWaypoints } } as never)
      endHistoryInteraction()
    },
    [id, updateEdge]
  )

  const handleMidpointPointerDown = useCallback(
    (e: React.PointerEvent, insertIndex: number) => {
      e.stopPropagation()
      const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const snapped = gridEnabledRef.current ? snapPoint(flowPos) : flowPos
      const newWaypoints = [...waypointsRef.current]
      newWaypoints.splice(insertIndex, 0, snapped)
      // begin antes del insert; el endHistoryInteraction lo cierra el onUp de
      // startWaypointDrag (begin es idempotente, así el insert + arrastre quedan
      // en una sola entrada de deshacer).
      beginHistoryInteraction()
      updateEdge(id, { data: { ...dataRef.current, waypoints: newWaypoints } } as never)
      startWaypointDrag(insertIndex)
    },
    [id, updateEdge, screenToFlowPosition, startWaypointDrag]
  )

  // Arrastre de la propia línea: en aristas ortogonales mueve el segmento más
  // cercano (la píldora es solo la pista visual); en el resto inserta un waypoint
  // y lo desliza, de modo que "mover el edge" lo dobla en vez de panear el canvas.
  const handleEdgePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!selectedRef.current) return
      e.stopPropagation()
      const startClient = { x: e.clientX, y: e.clientY }
      const startFlow = screenToFlowPosition(startClient)

      if (segmentEditing) {
        const corners = cornersFromRefs()
        const segIndex = nearestSegmentIndex(corners, startFlow)
        beginSegmentDrag(segIndex, startClient.x, startClient.y)
        return
      }

      const allPts = [srcPtRef.current, ...waypointsRef.current, tgtPtRef.current]
      const insertIndex = nearestSegmentIndex(allPts, startFlow)
      let inserted = false

      const onMove = (ev: PointerEvent) => {
        const flowPos = screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
        if (!inserted) {
          if (Math.hypot(ev.clientX - startClient.x, ev.clientY - startClient.y) < DRAG_THRESHOLD) return
          inserted = true
          draggingIndexRef.current = insertIndex
          setIsDragging(true)
          beginDragCursor()
          const newWaypoints = [...waypointsRef.current]
          newWaypoints.splice(insertIndex, 0, gridEnabledRef.current ? snapPoint(flowPos) : flowPos)
          beginHistoryInteraction()
          updateEdge(id, { data: { ...dataRef.current, waypoints: newWaypoints } } as never)
          return
        }
        const idx = draggingIndexRef.current
        if (idx === null) return
        const newWaypoints = [...waypointsRef.current]
        newWaypoints[idx] = gridEnabledRef.current ? snapPoint(flowPos) : flowPos
        updateEdge(id, { data: { ...dataRef.current, waypoints: newWaypoints } } as never)
      }

      const onUp = () => {
        draggingIndexRef.current = null
        setIsDragging(false)
        endDragCursor()
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        endHistoryInteraction()
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [id, updateEdge, screenToFlowPosition, segmentEditing, beginSegmentDrag]
  )

  // ---------------------------------------------------------------------------
  // Etiqueta arrastrable (solo EditableEdge): perpendicular al segmento = mover
  // el tramo (como la píldora); a lo largo = deslizar la etiqueta por ese tramo.
  // ---------------------------------------------------------------------------

  const handleLabelPointerDown = useCallback(
    (e: React.PointerEvent, pathEl: SVGPathElement | null) => {
      e.stopPropagation()
      if (!pathEl) return
      const startClient = { x: e.clientX, y: e.clientY }

      // En formas no ortogonales la etiqueta solo desliza por el trazado.
      if (!segmentEditing) {
        const onMove = (ev: PointerEvent) => {
          const flowPt = screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
          const result = projectOntoPath(pathEl, flowPt)
          beginHistoryInteraction()
          updateEdge(id, { data: { ...dataRef.current, labelT: result.t } } as never)
        }
        const onUp = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          endDragCursor()
          endHistoryInteraction()
        }
        beginDragCursor()
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        return
      }

      const corners = cornersFromRefs()
      const labelPt = pointAtPolylineT(corners, labelTRef.current)
      const seg = nearestSegmentIndex(corners, labelPt)
      const a = corners[seg]
      const b = corners[seg + 1] ?? corners[seg]
      const perpAxis = segPerpAxis(a, b)

      let mode: 'segment' | 'label' | null = null
      let segDrag: ((flowPos: Point) => void) | null = null

      // Arrastre de segmento desde la etiqueta: misma mecánica que
      // beginSegmentDrag pero ya en pleno movimiento (sin umbral).
      const createLabelSegmentDrag = (segIndex: number, axis: Axis) => {
        let idxA = -1
        let idxB = -1
        let started = false
        let wps: Point[] = [] // array de trabajo del gesto (evita la race con el ref)
        const alignTargets = cornersFromRefs()
          .filter((_, i) => i !== segIndex && i !== segIndex + 1)
          .map((p) => p[axis])
        const snapAxis = (v: number) => {
          const g = gridEnabledRef.current ? snapValue(v) : v
          if (!alignTargets.length) return g
          return snapToAlignment(g, alignTargets, ALIGN_SNAP_PX / (storeApi.getState().transform[2] || 1))
        }
        return (flowPos: Point) => {
          const val = snapAxis(axis === 'x' ? flowPos.x : flowPos.y)
          if (!started) {
            const cs = cornersFromRefs()
            if (segIndex >= cs.length - 1) return
            const plan = planSegmentDrag(cs, segIndex, axis, val)
            idxA = plan.idxA
            idxB = plan.idxB
            wps = plan.waypoints
            started = true
            setIsDragging(true)
            beginHistoryInteraction()
            updateEdge(id, { data: { ...dataRef.current, waypoints: wps } } as never)
            return
          }
          wps = wps.map((p) => ({ ...p }))
          if (wps[idxA]) wps[idxA][axis] = val
          if (wps[idxB]) wps[idxB][axis] = val
          updateEdge(id, { data: { ...dataRef.current, waypoints: wps } } as never)
        }
      }

      const onMove = (ev: PointerEvent) => {
        const flowPos = screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
        if (!mode) {
          if (Math.hypot(ev.clientX - startClient.x, ev.clientY - startClient.y) < DRAG_THRESHOLD) return
          const dPerp = perpAxis === 'x' ? ev.clientX - startClient.x : ev.clientY - startClient.y
          const dAlong = perpAxis === 'x' ? ev.clientY - startClient.y : ev.clientX - startClient.x
          mode = Math.abs(dPerp) > Math.abs(dAlong) ? 'segment' : 'label'
          if (mode === 'segment') segDrag = createLabelSegmentDrag(seg, perpAxis)
        }
        if (mode === 'segment') {
          segDrag?.(flowPos)
        } else {
          const clamped = clampToSegment(a, b, flowPos)
          const result = projectOntoPath(pathEl, clamped)
          beginHistoryInteraction()
          updateEdge(id, { data: { ...dataRef.current, labelT: result.t } } as never)
        }
      }

      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        setIsDragging(false)
        endDragCursor()
        endHistoryInteraction()
      }

      beginDragCursor()
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [id, updateEdge, screenToFlowPosition, segmentEditing]
  )

  // ---------------------------------------------------------------------------
  // Extremos: deslizan por TODO el perímetro del nodo (proyección al borde más
  // cercano, sin lado fijo) y flashan pegándose al punto medio de un lado cuando
  // se acercan. Sobre otro nodo previsualizan la reconexión (anclaje flotante).
  // ---------------------------------------------------------------------------

  const handleEndpointPointerDown = useCallback(
    (e: React.PointerEvent, which: 'source' | 'target') => {
      e.stopPropagation()
      setAnchorDragging(which)
      beginDragCursor()
      const anchorKey = which === 'source' ? 'sourceAnchor' : 'targetAnchor'
      const ownIdRef = which === 'source' ? sourceRef : targetRef
      const fixedIdRef = which === 'source' ? targetRef : sourceRef

      const resolveHoveredNode = (clientX: number, clientY: number) => {
        const els = document.elementsFromPoint(clientX, clientY)
        const nodeEl = els.find((el) => el.classList.contains('react-flow__node'))
        return nodeEl?.getAttribute('data-id') ?? null
      }

      const onMove = (ev: PointerEvent) => {
        const flowPos = screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
        const hoveredId = resolveHoveredNode(ev.clientX, ev.clientY)
        const fixedId = fixedIdRef.current
        const ownId = ownIdRef.current
        const { nodeLookup } = storeApi.getState()

        // Sobre OTRO nodo distinto → previsualizar re-conexión (anclaje flotante).
        if (hoveredId && hoveredId !== fixedId && hoveredId !== ownId) {
          const hoveredNode = nodeLookup.get(hoveredId)
          const fixedNode = nodeLookup.get(fixedId)
          if (hoveredNode && fixedNode) {
            const snapped = getFloatingAnchor(hoveredNode as never, fixedNode as never)
            setAnchorSnappedPt({ x: snapped.x, y: snapped.y })
            setAnchorCursor(flowPos)
            setAnchorFlash(false)
            return
          }
        }

        // Sobre el propio nodo (o fuera) → deslizar por el perímetro completo.
        const ownNode = nodeLookup.get(ownId)
        if (ownNode) {
          let norm = projectToNodePerimeter(ownNode as never, flowPos)
          // Pegado al punto medio del lado más cercano cuando entra en el radio.
          const mid = nearestSideMidpoint(norm)
          const here = getAnchorPoint(ownNode as never, norm)
          const midAbs = getAnchorPoint(ownNode as never, mid)
          const flash = Math.hypot(here.x - midAbs.x, here.y - midAbs.y) <= MIDPOINT_SNAP
          if (flash) norm = mid
          setAnchorFlash(flash)
          // En aristas ortogonales con codos, arrastra la esquina contigua junto al
          // anclaje para que el tramo pegado al nodo se traslade RECTO en vez de
          // escalonarse. El eje que se ajusta es el de salida (perpendicular al
          // lado): Top/Bottom → x; Left/Right → y.
          const patch: Record<string, unknown> = { ...dataRef.current, [anchorKey]: norm }
          const wpsNow = dataRef.current.waypoints ?? []
          if (segmentEditing && wpsNow.length) {
            const anchorAbs = getAnchorPoint(ownNode as never, norm)
            const side = anchorToPosition(norm)
            const exitAxis: Axis = side === Position.Top || side === Position.Bottom ? 'x' : 'y'
            const cornerIdx = which === 'source' ? 0 : wpsNow.length - 1
            const wps = wpsNow.map((p) => ({ ...p }))
            if (wps[cornerIdx]) wps[cornerIdx][exitAxis] = anchorAbs[exitAxis]
            patch.waypoints = wps
          }
          beginHistoryInteraction()
          updateEdge(id, { data: patch } as never)
        }
        setAnchorSnappedPt(null)
        setAnchorCursor(null)
      }

      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        const hoveredId = resolveHoveredNode(ev.clientX, ev.clientY)
        const fixedId = fixedIdRef.current
        const ownId = ownIdRef.current
        if (hoveredId && hoveredId !== fixedId && hoveredId !== ownId) {
          const { nodeLookup } = storeApi.getState()
          const hoveredNode = nodeLookup.get(hoveredId)
          const fixedNode = nodeLookup.get(fixedId)
          if (hoveredNode && fixedNode) {
            // Reconecta al nodo nuevo y limpia el anclaje fijo: vuelve a flotante.
            const reconnect =
              which === 'source'
                ? { source: hoveredId, sourceHandle: undefined }
                : { target: hoveredId, targetHandle: undefined }
            beginHistoryInteraction()
            updateEdge(id, {
              ...reconnect,
              data: { ...dataRef.current, [anchorKey]: undefined },
            } as never)
          }
        }
        // El deslizamiento por el perímetro ya se confirmó en vivo en onMove.
        setAnchorDragging(null)
        setAnchorCursor(null)
        setAnchorSnappedPt(null)
        setAnchorFlash(false)
        endDragCursor()
        endHistoryInteraction()
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [id, updateEdge, screenToFlowPosition, storeApi]
  )

  // Doble clic en un extremo → restaura el anclaje flotante automático.
  const handleEndpointDoubleClick = useCallback(
    (e: React.MouseEvent, which: 'source' | 'target') => {
      e.stopPropagation()
      const anchorKey = which === 'source' ? 'sourceAnchor' : 'targetAnchor'
      beginHistoryInteraction()
      updateEdge(id, { data: { ...dataRef.current, [anchorKey]: undefined } } as never)
      endHistoryInteraction()
    },
    [id, updateEdge]
  )

  // ---------------------------------------------------------------------------
  // Geometría para pintar handles
  // ---------------------------------------------------------------------------

  const corners = segmentEditing ? computeCorners(srcPt, tgtPt, waypoints) : []
  // Handle en el centro de cada tramo ortogonal. Los tramos centrales llevan una
  // píldora; los pegados a un nodo (con el otro extremo libre) llevan un círculo
  // que divide el tramo desde el centro. El tramo único entre dos nodos es píldora.
  const segCount = corners.length - 1
  const segmentPills = corners.slice(0, -1).map((a, i) => {
    const b = corners[i + 1]
    const vertical = Math.abs(a.x - b.x) < Math.abs(a.y - b.y)
    const isFirst = i === 0
    const isLast = i === segCount - 1
    const nodeAdjacent = (isFirst || isLast) && !(isFirst && isLast)
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      vertical, // segmento vertical → se mueve en horizontal
      segIndex: i,
      nodeAdjacent,
    }
  })

  // Midpoints para insertar waypoints (solo formas no ortogonales). Si la
  // etiqueta cae dentro de un segmento, lo partimos en dos para poner un midpoint
  // a cada lado de ella.
  const allPts = [srcPt, ...waypoints, tgtPt]
  const labelPoint = !segmentEditing && hasLabel ? pointAtPolylineT(allPts, labelT ?? 0.5) : null
  const labelSeg = labelPoint ? nearestSegmentIndex(allPts, labelPoint) : -1
  const midpoints: { x: number; y: number; insertIndex: number }[] = []
  if (!segmentEditing) {
    for (let i = 0; i < allPts.length - 1; i++) {
      const a = allPts[i]
      const b = allPts[i + 1]
      if (labelPoint && i === labelSeg) {
        midpoints.push({ x: (a.x + labelPoint.x) / 2, y: (a.y + labelPoint.y) / 2, insertIndex: i })
        midpoints.push({ x: (labelPoint.x + b.x) / 2, y: (labelPoint.y + b.y) / 2, insertIndex: i })
      } else {
        midpoints.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, insertIndex: i })
      }
    }
  }

  const editingLayer = selected ? (
    <>
      {anchorDragging && anchorCursor && (() => {
        const dragPt = anchorSnappedPt ?? anchorCursor
        const fromPt = anchorDragging === 'source' ? dragPt : srcPt
        const toPt = anchorDragging === 'target' ? dragPt : tgtPt
        return (
          <path
            d={`M ${fromPt.x},${fromPt.y} L ${toPt.x},${toPt.y}`}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            style={{ pointerEvents: 'none' }}
          />
        )
      })()}
      <EdgeLabelRenderer>
        {segmentEditing ? (
          <>
            {/* Handle en el centro de cada tramo: círculo en los pegados a un nodo
                (divide desde el centro), píldora en el resto. No se pintan puntos
                en las esquinas: se enderezan arrastrando el tramo. */}
            {segmentPills.map((sp) => (
              <div
                key={`seg-${sp.segIndex}`}
                className="nopan nodrag edge-handle"
                style={{
                  position: 'absolute',
                  transform: `translate(-50%, -50%) translate(${sp.x}px,${sp.y}px)`,
                  cursor: isDragging ? 'grabbing' : sp.vertical ? 'ew-resize' : 'ns-resize',
                }}
                onPointerDown={(e) => handleSegmentPointerDown(e, sp.segIndex)}
              >
                {sp.nodeAdjacent ? (
                  <div className="edge-handle__circle" style={{ width: 11, height: 11 }} />
                ) : (
                  <div
                    className="edge-handle__pill"
                    style={{ width: sp.vertical ? 8 : 18, height: sp.vertical ? 18 : 8 }}
                  />
                )}
              </div>
            ))}
          </>
        ) : (
          <>
            {/* Midpoints fantasma — clic para insertar un waypoint nuevo */}
            {midpoints.map((mp, mi) => (
              <div
                key={`mid-${mi}`}
                className="nopan nodrag"
                style={{
                  position: 'absolute',
                  transform: `translate(-50%, -50%) translate(${mp.x}px,${mp.y}px)`,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'white',
                  border: '1.5px solid var(--color-accent)',
                  pointerEvents: 'all',
                  cursor: isDragging ? 'grabbing' : 'grab',
                }}
                onPointerDown={(e) => handleMidpointPointerDown(e, mp.insertIndex)}
              />
            ))}
            {/* Waypoints existentes — arrastrar para mover, doble clic para borrar */}
            {waypoints.map((wp, i) => (
              <div
                key={`wp-${i}`}
                className="nopan nodrag"
                style={{
                  position: 'absolute',
                  transform: `translate(-50%, -50%) translate(${wp.x}px,${wp.y}px)`,
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: 'var(--color-accent)',
                  pointerEvents: 'all',
                  cursor: isDragging && draggingIndexRef.current === i ? 'grabbing' : 'grab',
                }}
                onPointerDown={(e) => handleWaypointPointerDown(e, i)}
                onDoubleClick={(e) => handleWaypointDoubleClick(e, i)}
              />
            ))}
          </>
        )}
        {/* Extremos — arrastrar para deslizar por el borde / reconectar a otro nodo */}
        {(['source', 'target'] as const).map((which) => {
          const pt = which === 'source' ? srcPt : tgtPt
          const flashing = anchorDragging === which && anchorFlash
          return (
            <div
              key={`anchor-${which}`}
              className="nopan nodrag edge-handle"
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${pt.x}px,${pt.y}px)`,
                cursor: anchorDragging === which ? 'grabbing' : 'grab',
                zIndex: 10,
              }}
              onPointerDown={(e) => handleEndpointPointerDown(e, which)}
              onDoubleClick={(e) => handleEndpointDoubleClick(e, which)}
            >
              <div
                className={`edge-handle__endpoint${flashing ? ' is-flash' : ''}`}
                style={{ width: 11, height: 11 }}
              />
            </div>
          )
        })}
      </EdgeLabelRenderer>
    </>
  ) : null

  return {
    srcPt,
    tgtPt,
    waypoints,
    corners,
    srcPositionOverride,
    tgtPositionOverride,
    editingLayer,
    handleEdgePointerDown,
    handlePathDoubleClick,
    handleLabelPointerDown,
  }
}

// Longitud del codo perpendicular con que un extremo anclado a un lado abandona
// el nodo (px de flujo). Es el "stub" estilo draw.io para que la línea nunca
// salga rasante al borde.
const ENDPOINT_STUB = 22

// Esquinas ortogonales efectivas. Cada extremo cuyo lado se conoce abandona el
// nodo PERPENDICULAR a ese lado, tanto en la ruta por defecto (sin waypoints, Z
// por el centro) como con waypoints intermedios (stub perpendicular + L-bends).
// Es la fuente de verdad compartida por las píldoras y por el trazado renderizado.
function routeCorners(
  src: Point,
  tgt: Point,
  waypoints: Point[],
  srcPos?: Position,
  tgtPos?: Position
): Point[] {
  if (waypoints.length === 0) {
    // Orientación del Z: la marca el lado conocido (origen con prioridad). Sin
    // lado conocido, L-bend horizontal-primero por defecto.
    const vertical = srcPos ? isVerticalSide(srcPos) : tgtPos ? isVerticalSide(tgtPos) : null
    if (vertical === null) return getElbowCorners(src, tgt, [])
    const mid: Point[] = vertical
      ? [
          { x: src.x, y: (src.y + tgt.y) / 2 },
          { x: tgt.x, y: (src.y + tgt.y) / 2 },
        ]
      : [
          { x: (src.x + tgt.x) / 2, y: src.y },
          { x: (src.x + tgt.x) / 2, y: tgt.y },
        ]
    // getElbowCorners limpia colineales/duplicados (p. ej. nodos alineados).
    return getElbowCorners(src, tgt, mid)
  }
  // Con waypoints: inserta un stub perpendicular en cada extremo anclado para que
  // el tramo pegado al nodo salga en codo. El stub es colineal con el extremo en
  // su eje perpendicular, así getElbowCorners lo colapsa cuando es redundante (no
  // acumula esquinas al re-rutear sobre waypoints ya normalizados).
  const mids = [...waypoints]
  if (srcPos) mids.unshift(stubPoint(src, srcPos))
  if (tgtPos) mids.push(stubPoint(tgt, tgtPos))
  return getElbowCorners(src, tgt, mids)
}

// True si el lado es arriba/abajo (la arista lo cruza en vertical).
function isVerticalSide(pos: Position): boolean {
  return pos === Position.Top || pos === Position.Bottom
}

// Punto desplazado ENDPOINT_STUB hacia fuera del lado `pos` desde `pt`.
function stubPoint(pt: Point, pos: Position): Point {
  switch (pos) {
    case Position.Top:
      return { x: pt.x, y: pt.y - ENDPOINT_STUB }
    case Position.Bottom:
      return { x: pt.x, y: pt.y + ENDPOINT_STUB }
    case Position.Left:
      return { x: pt.x - ENDPOINT_STUB, y: pt.y }
    default:
      return { x: pt.x + ENDPOINT_STUB, y: pt.y }
  }
}

// Lado del perímetro en el que cae un punto absoluto (proyectado al borde más
// cercano del nodo). Deriva la dirección de salida de un extremo flotante.
function sideOfPoint(node: ReturnType<typeof useInternalNode>, pt: Point): Position | undefined {
  return node ? anchorToPosition(projectToNodePerimeter(node as never, pt)) : undefined
}

// ---------------------------------------------------------------------------
// Helpers de segmentos ortogonales
// ---------------------------------------------------------------------------

// Pega `val` a la coordenada más cercana de `targets` si cae dentro de
// `threshold` (px de flujo). Mantiene rectos los tramos casi colineales sin
// necesidad de grid.
function snapToAlignment(val: number, targets: number[], threshold: number): number {
  let best = val
  let bestD = threshold
  for (const c of targets) {
    const d = Math.abs(c - val)
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}

// Eje que hay que modificar para mover un segmento PERPENDICULAR a su
// orientación: un tramo horizontal (misma y) se mueve cambiando la y; uno
// vertical (misma x), cambiando la x.
function segPerpAxis(a: Point, b: Point): Axis {
  return Math.abs(a.y - b.y) < Math.abs(a.x - b.x) ? 'y' : 'x'
}

// Calcula los waypoints resultantes de mover el segmento `segIndex` al valor
// `newVal` en el eje `axis`, devolviendo además los índices (en el array de
// waypoints = esquinas interiores) de las dos esquinas que hay que seguir
// moviendo. Un tramo pegado a un nodo PERO con su otro extremo libre dobla
// desde el CENTRO del segmento: la mitad pegada al nodo se queda fija (el codo
// nace en el centro, no en el nodo). El tramo único entre dos nodos se grapa con
// un stub a cada lado.
function planSegmentDrag(
  corners: Point[],
  segIndex: number,
  axis: Axis,
  newVal: number
): { waypoints: Point[]; idxA: number; idxB: number } {
  const L = corners.length
  const isFirst = segIndex === 0
  const isLast = segIndex === L - 2
  const other: Axis = axis === 'x' ? 'y' : 'x'
  const interior = corners.slice(1, L - 1).map((p) => ({ ...p }))
  const set = (p: Point): Point => ({ ...p, [axis]: newVal })

  if (isFirst && isLast) {
    // Tramo único entre dos nodos: grapa con stub a cada lado.
    return { waypoints: [set(corners[0]), set(corners[L - 1])], idxA: 0, idxB: 1 }
  }
  if (isFirst) {
    // Codo desde el centro: la mitad nodo→centro (P1) se mantiene en su valor
    // original; solo se mueve la mitad libre (P2 + esquina C).
    const node = corners[0]
    const free = corners[1]
    const centerAlong = (node[other] + free[other]) / 2
    const P1 = { ...node, [other]: centerAlong } // centro, valor perp original (fijo)
    const P2 = { ...P1, [axis]: newVal } // centro, ya desplazado
    const movedFree = set(free)
    return { waypoints: [P1, P2, movedFree, ...interior.slice(1)], idxA: 1, idxB: 2 }
  }
  if (isLast) {
    const node = corners[L - 1]
    const free = corners[L - 2]
    const centerAlong = (node[other] + free[other]) / 2
    const P1 = { ...node, [other]: centerAlong } // centro, valor perp original (fijo)
    const P2 = { ...P1, [axis]: newVal }
    const movedFree = set(free)
    const li = interior.length - 1
    return { waypoints: [...interior.slice(0, -1), movedFree, P2, P1], idxA: li, idxB: li + 1 }
  }
  // Segmento interior: mueve sus dos esquinas.
  const iA = segIndex - 1
  const iB = segIndex
  interior[iA] = set(interior[iA])
  interior[iB] = set(interior[iB])
  return { waypoints: interior, idxA: iA, idxB: iB }
}

// Punto medio normalizado del lado más cercano a un anclaje [0..1].
function nearestSideMidpoint(anchor: Point): Point {
  const mids: Point[] = [
    { x: 0.5, y: 0 }, // top
    { x: 1, y: 0.5 }, // right
    { x: 0.5, y: 1 }, // bottom
    { x: 0, y: 0.5 }, // left
  ]
  let best = mids[0]
  let bestD = Infinity
  for (const m of mids) {
    const d = Math.hypot(m.x - anchor.x, m.y - anchor.y)
    if (d < bestD) {
      bestD = d
      best = m
    }
  }
  return best
}

// Proyecta un punto sobre el segmento [a,b] y lo clampa a sus extremos.
function clampToSegment(a: Point, b: Point, p: Point): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return { ...a }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return { x: a.x + t * dx, y: a.y + t * dy }
}

// Índice del segmento [i, i+1] de la polilínea más cercano a un punto.
function nearestSegmentIndex(pts: Point[], p: Point): number {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const d = pointToSegmentDist(p, pts[i], pts[i + 1])
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

// Punto a la fracción t [0..1] de la longitud total de la polilínea.
function pointAtPolylineT(pts: Point[], t: number): Point {
  if (pts.length === 1) return pts[0]
  const segLens: number[] = []
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y)
    segLens.push(l)
    total += l
  }
  if (total === 0) return pts[0]
  const target = Math.max(0, Math.min(1, t)) * total
  let acc = 0
  for (let i = 0; i < segLens.length; i++) {
    if (acc + segLens[i] >= target) {
      const f = segLens[i] === 0 ? 0 : (target - acc) / segLens[i]
      return {
        x: pts[i].x + f * (pts[i + 1].x - pts[i].x),
        y: pts[i].y + f * (pts[i + 1].y - pts[i].y),
      }
    }
    acc += segLens[i]
  }
  return pts[pts.length - 1]
}

function pointToSegmentDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}
