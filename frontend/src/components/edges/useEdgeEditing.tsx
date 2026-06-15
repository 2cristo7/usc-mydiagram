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
import { getFloatingAnchor } from '../../ui/utils/getFloatingAnchor'
import { getAnchorPoint, projectToNodePerimeter, projectOntoSide, anchorToPosition } from '../../ui/utils/getNodeAnchor'
import { snapPoint } from '../../ui/utils/grid'
import type { EdgeVisualData } from '../../types'

type Point = { x: number; y: number }

// Lógica de edición compartida por EditableEdge y ArchitectureEdge: calcula los
// extremos efectivos (anclaje fijo deslizado sobre el borde con prioridad sobre
// el punto por defecto, más snapping al grid), expone los waypoints y devuelve
// la capa de handles (waypoints, midpoints e extremos arrastrables) lista para
// pintar cuando la arista está seleccionada. Cada edge conserva su propio
// routing; este hook solo aporta el overlay de edición y el override de extremo.
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
  // trazado (labelT en [0..1]) parte el segmento que la contiene en dos, para
  // poner un midpoint a cada lado de ella.
  hasLabel?: boolean
  labelT?: number
}) {
  const { id, source, target, data, selected, defaultSrcPt, defaultTgtPt, hasLabel, labelT } = args
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
  // sobre el extremo por defecto. El snapping al grid del punto por defecto lo
  // aplica cada edge antes de pasarlo (EditableEdge ambos ejes; ArchitectureEdge
  // solo el eje de salida): aquí un anclaje fijo NO se snappea, lo apartaría del
  // borde del nodo.
  const srcPt = sourceAnchor && sourceNode
    ? getAnchorPoint(sourceNode as never, sourceAnchor)
    : defaultSrcPt
  const tgtPt = targetAnchor && targetNode
    ? getAnchorPoint(targetNode as never, targetAnchor)
    : defaultTgtPt

  const srcPositionOverride: Position | undefined = sourceAnchor ? anchorToPosition(sourceAnchor) : undefined
  const tgtPositionOverride: Position | undefined = targetAnchor ? anchorToPosition(targetAnchor) : undefined

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
  const draggingIndexRef = useRef<number | null>(null)
  // Posición actual de cada extremo: la lee el handler de arrastre para fijar
  // el lado del nodo al empezar (y deslizar solo por él).
  const srcPtRef = useRef(srcPt)
  srcPtRef.current = srcPt
  const tgtPtRef = useRef(tgtPt)
  tgtPtRef.current = tgtPt

  const [isDragging, setIsDragging] = useState(false)
  const [anchorDragging, setAnchorDragging] = useState<'source' | 'target' | null>(null)
  const [anchorCursor, setAnchorCursor] = useState<Point | null>(null)
  const [anchorSnappedPt, setAnchorSnappedPt] = useState<Point | null>(null)

  // Arrastre de waypoint: listeners window-level para no perder el puntero en
  // los re-renders provocados por updateEdge.
  const startWaypointDrag = useCallback(
    (index: number) => {
      draggingIndexRef.current = index
      setIsDragging(true)

      const onMove = (e: PointerEvent) => {
        const idx = draggingIndexRef.current
        if (idx === null) return
        const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
        const newWaypoints = [...waypointsRef.current]
        newWaypoints[idx] = gridEnabledRef.current ? snapPoint(flowPos) : flowPos
        updateEdge(id, { data: { ...dataRef.current, waypoints: newWaypoints } } as never)
      }

      const onUp = () => {
        draggingIndexRef.current = null
        setIsDragging(false)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
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
      updateEdge(id, { data: { ...dataRef.current, waypoints: newWaypoints } } as never)
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
      updateEdge(id, { data: { ...dataRef.current, waypoints: newWaypoints } } as never)
      startWaypointDrag(insertIndex)
    },
    [id, updateEdge, screenToFlowPosition, startWaypointDrag]
  )

  // Arrastre de la propia línea: al tirar del trazado (con la arista
  // seleccionada) inserta un waypoint en el tramo agarrado y lo desliza, de modo
  // que "mover el edge" lo dobla en vez de panear el canvas. Un umbral de unos
  // pocos píxeles distingue un clic (selección) de un arrastre (doblez).
  const handleEdgePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!selectedRef.current) return
      e.stopPropagation()
      const startClient = { x: e.clientX, y: e.clientY }
      const startFlow = screenToFlowPosition(startClient)
      const allPts = [srcPtRef.current, ...waypointsRef.current, tgtPtRef.current]
      const insertIndex = nearestSegmentIndex(allPts, startFlow)
      let inserted = false

      const onMove = (ev: PointerEvent) => {
        const flowPos = screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
        if (!inserted) {
          if (Math.hypot(ev.clientX - startClient.x, ev.clientY - startClient.y) < 4) return
          inserted = true
          draggingIndexRef.current = insertIndex
          setIsDragging(true)
          const newWaypoints = [...waypointsRef.current]
          newWaypoints.splice(insertIndex, 0, gridEnabledRef.current ? snapPoint(flowPos) : flowPos)
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
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [id, updateEdge, screenToFlowPosition]
  )

  const handleEndpointPointerDown = useCallback(
    (e: React.PointerEvent, which: 'source' | 'target') => {
      e.stopPropagation()
      setAnchorDragging(which)
      const anchorKey = which === 'source' ? 'sourceAnchor' : 'targetAnchor'
      const ownIdRef = which === 'source' ? sourceRef : targetRef
      const fixedIdRef = which === 'source' ? targetRef : sourceRef

      // Lado del nodo fijado al empezar el arrastre: se desliza SOLO por él, así
      // el extremo no salta de borde al pasar cerca de una esquina.
      const startPt = which === 'source' ? srcPtRef.current : tgtPtRef.current
      const startNode = storeApi.getState().nodeLookup.get(ownIdRef.current)
      const lockedSide = startNode
        ? anchorToPosition(projectToNodePerimeter(startNode as never, startPt))
        : Position.Top

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
            return
          }
        }

        // Sobre el propio nodo (o fuera) → deslizar por el lado fijado, en vivo.
        const ownNode = nodeLookup.get(ownId)
        if (ownNode) {
          const norm = projectOntoSide(ownNode as never, lockedSide, flowPos)
          updateEdge(id, { data: { ...dataRef.current, [anchorKey]: norm } } as never)
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
      updateEdge(id, { data: { ...dataRef.current, [anchorKey]: undefined } } as never)
    },
    [id, updateEdge]
  )

  // Midpoints para insertar waypoints. Si la etiqueta (la "tarjeta") cae dentro
  // de un segmento, lo partimos en dos para poner un midpoint a cada lado de ella
  // (nodo→tarjeta y tarjeta→nodo); así, además, el único midpoint no queda oculto
  // debajo de la etiqueta. Ambas mitades insertan el waypoint en el mismo índice.
  const allPts = [srcPt, ...waypoints, tgtPt]
  const labelPoint = hasLabel ? pointAtPolylineT(allPts, labelT ?? 0.5) : null
  const labelSeg = labelPoint ? nearestSegmentIndex(allPts, labelPoint) : -1
  const midpoints: { x: number; y: number; insertIndex: number }[] = []
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
        {/* Extremos — arrastrar para deslizar por el borde / reconectar a otro nodo */}
        {(['source', 'target'] as const).map((which) => {
          const pt = which === 'source' ? srcPt : tgtPt
          return (
            <div
              key={`anchor-${which}`}
              className="nopan nodrag"
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${pt.x}px,${pt.y}px)`,
                width: 11,
                height: 11,
                borderRadius: '50%',
                background: 'white',
                border: '2px solid #3b82f6',
                boxShadow: '0 0 0 1px white',
                pointerEvents: 'all',
                cursor: anchorDragging === which ? 'grabbing' : 'grab',
                zIndex: 10,
              }}
              onPointerDown={(e) => handleEndpointPointerDown(e, which)}
              onDoubleClick={(e) => handleEndpointDoubleClick(e, which)}
            />
          )
        })}
      </EdgeLabelRenderer>
    </>
  ) : null

  return { srcPt, tgtPt, waypoints, srcPositionOverride, tgtPositionOverride, editingLayer, handleEdgePointerDown }
}

// Índice del segmento [i, i+1] de la polilínea más cercano a un punto. Se usa
// para saber en qué tramo cae la etiqueta y partirlo.
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

// Punto a la fracción t [0..1] de la longitud total de la polilínea (donde se
// posa la etiqueta). Aproxima la posición sobre trazados curvos lo bastante bien
// para colocar los midpoints a ambos lados de la "tarjeta".
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
