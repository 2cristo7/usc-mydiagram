import { useRef, useState, useLayoutEffect, useCallback } from 'react'
import {
  EdgeLabelRenderer,
  useInternalNode,
  useReactFlow,
  useStoreApi,
  type EdgeProps,
} from '@xyflow/react'
import { useInlineEdit } from '../../hooks/useInlineEdit'
import { useStore } from '../../store'
import { projectOntoPath } from '../../ui/utils/getPathProjection'
import { getFloatingAnchor } from '../../ui/utils/getFloatingAnchor'
import { getWaypointPath } from '../../ui/utils/getWaypointPath'
import type { EdgeVisualData } from '../../types'

type Point = { x: number; y: number }

export function EditableEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  data,
  selected,
}: EdgeProps) {
  const edgeData = (data ?? {}) as EdgeVisualData
  const label = edgeData.label ?? ''
  const labelT = edgeData.labelT ?? 0.5
  const waypoints = edgeData.waypoints ?? []
  const shape = edgeData.shape ?? 'curved'
  const strokeStyle = edgeData.strokeStyle ?? 'normal'
  const arrowStart = edgeData.sourceArrow ?? false
  const arrowEnd = edgeData.targetArrow ?? true

  const updateEdge = useStore((s) => s.updateEdge)
  const { screenToFlowPosition } = useReactFlow()
  const storeApi = useStoreApi()

  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)

  const srcAnchor = sourceNode && targetNode
    ? getFloatingAnchor(sourceNode as never, targetNode as never)
    : null
  const tgtAnchor = sourceNode && targetNode
    ? getFloatingAnchor(targetNode as never, sourceNode as never)
    : null

  const srcPt = srcAnchor ?? { x: sourceX, y: sourceY }
  const tgtPt = tgtAnchor ?? { x: targetX, y: targetY }

  const [edgePath, labelX, labelY] = getWaypointPath(srcPt, tgtPt, waypoints, shape)

  const strokeDasharray =
    strokeStyle === 'dashed' ? '8 4' :
    strokeStyle === 'dotted' ? '2 4' :
    undefined

  const computedMarkerStart = arrowStart ? 'url(#arrowReverse)' : undefined
  const computedMarkerEnd = arrowEnd ? 'url(#arrow)' : undefined

  const pathRef = useRef<SVGPathElement>(null)
  const [labelPos, setLabelPos] = useState({ x: labelX, y: labelY })
  const [isDragging, setIsDragging] = useState(false)

  // Re-anchor state: which endpoint is being dragged + cursor/snapped positions
  const [anchorDragging, setAnchorDragging] = useState<'source' | 'target' | null>(null)
  const [anchorCursor, setAnchorCursor] = useState<Point | null>(null)
  const [anchorSnappedPt, setAnchorSnappedPt] = useState<Point | null>(null)
  const sourceRef = useRef(source)
  sourceRef.current = source
  const targetRef = useRef(target)
  targetRef.current = target

  // Keep refs current so window listeners never see stale values
  const waypointsRef = useRef(waypoints)
  waypointsRef.current = waypoints
  const edgeDataRef = useRef(edgeData)
  edgeDataRef.current = edgeData
  const draggingIndexRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    if (pathRef.current && labelT !== 0.5) {
      const el = pathRef.current
      const p = el.getPointAtLength(labelT * el.getTotalLength())
      setLabelPos({ x: p.x, y: p.y })
    } else {
      setLabelPos({ x: labelX, y: labelY })
    }
  }, [labelX, labelY, labelT])

  const { isEditing, startEditing, inputProps, containerProps } = useInlineEdit({
    initialValue: label,
    onCommit: (newLabel) => {
      updateEdge(id, { data: { ...edgeData, label: newLabel } } as never)
    },
  })

  const handlePathDoubleClick = useCallback(() => {
    startEditing()
  }, [startEditing])

  const handleLabelMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isEditing) return
      e.stopPropagation()
      const pathEl = pathRef.current
      if (!pathEl) return

      const onMove = (mv: MouseEvent) => {
        const flowPt = screenToFlowPosition({ x: mv.clientX, y: mv.clientY })
        const result = projectOntoPath(pathEl, flowPt)
        updateEdge(id, { data: { ...edgeDataRef.current, labelT: result.t } } as never)
      }

      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [id, isEditing, updateEdge, screenToFlowPosition]
  )

  // Shared drag logic — attaches window-level listeners so re-renders don't lose pointer capture
  const startWaypointDrag = useCallback(
    (index: number) => {
      draggingIndexRef.current = index
      setIsDragging(true)

      const onMove = (e: PointerEvent) => {
        const idx = draggingIndexRef.current
        if (idx === null) return
        const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
        const newWaypoints = [...waypointsRef.current]
        newWaypoints[idx] = flowPos
        updateEdge(id, { data: { ...edgeDataRef.current, waypoints: newWaypoints } } as never)
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
      updateEdge(id, { data: { ...edgeDataRef.current, waypoints: newWaypoints } } as never)
    },
    [id, updateEdge]
  )

  const handleEndpointPointerDown = useCallback(
    (e: React.PointerEvent, which: 'source' | 'target') => {
      e.stopPropagation()
      setAnchorDragging(which)

      const resolveHoveredNode = (clientX: number, clientY: number) => {
        const els = document.elementsFromPoint(clientX, clientY)
        const nodeEl = els.find((el) => el.classList.contains('react-flow__node'))
        return nodeEl?.getAttribute('data-id') ?? null
      }

      const onMove = (ev: PointerEvent) => {
        const flowPos = screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
        const hoveredId = resolveHoveredNode(ev.clientX, ev.clientY)
        const fixedId = which === 'source' ? targetRef.current : sourceRef.current
        if (hoveredId && hoveredId !== fixedId) {
          const { nodeLookup } = storeApi.getState()
          const hoveredNode = nodeLookup.get(hoveredId)
          const fixedNode = nodeLookup.get(fixedId)
          if (hoveredNode && fixedNode) {
            const snapped = getFloatingAnchor(hoveredNode as never, fixedNode as never)
            setAnchorSnappedPt({ x: snapped.x, y: snapped.y })
            setAnchorCursor(flowPos)
            return
          }
        }
        setAnchorSnappedPt(null)
        setAnchorCursor(flowPos)
      }

      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        const hoveredId = resolveHoveredNode(ev.clientX, ev.clientY)
        const fixedId = which === 'source' ? targetRef.current : sourceRef.current
        if (hoveredId && hoveredId !== fixedId) {
          const { nodeLookup } = storeApi.getState()
          const hoveredNode = nodeLookup.get(hoveredId)
          const fixedNode = nodeLookup.get(fixedId)
          if (hoveredNode && fixedNode) {
            if (which === 'source') {
              updateEdge(id, { source: hoveredId, sourceHandle: undefined } as never)
            } else {
              updateEdge(id, { target: hoveredId, targetHandle: undefined } as never)
            }
          }
        }
        setAnchorDragging(null)
        setAnchorCursor(null)
        setAnchorSnappedPt(null)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [id, updateEdge, screenToFlowPosition, storeApi]
  )

  const handleMidpointPointerDown = useCallback(
    (e: React.PointerEvent, insertIndex: number) => {
      e.stopPropagation()
      const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const newWaypoints = [...waypointsRef.current]
      newWaypoints.splice(insertIndex, 0, flowPos)
      updateEdge(id, { data: { ...edgeDataRef.current, waypoints: newWaypoints } } as never)
      startWaypointDrag(insertIndex)
    },
    [id, updateEdge, screenToFlowPosition, startWaypointDrag]
  )

  const allPts = [srcPt, ...waypoints, tgtPt]
  const midpoints = allPts.slice(0, -1).map((pt, i) => ({
    x: (pt.x + allPts[i + 1].x) / 2,
    y: (pt.y + allPts[i + 1].y) / 2,
    insertIndex: i,
  }))

  const showLabel = label !== '' || isEditing

  return (
    <>
      {/* wide invisible hit area for easier double-click targeting */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onDoubleClick={handlePathDoubleClick}
      />
      {/* visible path */}
      <path
        ref={pathRef}
        d={edgePath}
        fill="none"
        stroke="var(--color-ink)"
        strokeWidth={2}
        strokeDasharray={strokeDasharray}
        markerEnd={computedMarkerEnd}
        markerStart={computedMarkerStart}
        style={style}
      />
      {anchorDragging && anchorCursor && (() => {
        const dragPt = anchorSnappedPt ?? anchorCursor
        const fromPt = anchorDragging === 'source' ? dragPt : srcPt
        const toPt   = anchorDragging === 'target' ? dragPt : tgtPt
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
      {showLabel && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelPos.x}px,${labelPos.y}px)`,
              pointerEvents: 'all',
              cursor: isEditing ? 'text' : 'grab',
            }}
            className={`bg-[var(--color-surface)] border-2 border-[var(--color-ink)] px-2 py-0.5 text-sm font-[var(--font-sans)] shadow-[2px_2px_0_var(--color-ink)] ${containerProps.className}`}
            onDoubleClick={containerProps.onDoubleClick}
            onMouseDown={handleLabelMouseDown}
          >
            {isEditing ? (
              <input
                {...inputProps}
                className="bg-transparent border-0 outline-none text-sm font-[var(--font-sans)] min-w-[4rem]"
              />
            ) : (
              label
            )}
          </div>
        </EdgeLabelRenderer>
      )}
      {selected && (
        <EdgeLabelRenderer>
          {/* Ghost midpoint circles — click to insert a new waypoint */}
          {midpoints.map((mp) => (
            <div
              key={`mid-${mp.insertIndex}`}
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
          {/* Existing waypoint circles — drag to move, double-click to remove */}
          {waypoints.map((wp, i) => (
            <div
              key={`wp-${i}`}
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
          {/* Endpoint re-anchor handles — drag to reconnect edge to a different node */}
          {(['source', 'target'] as const).map((which) => {
            const pt = which === 'source' ? srcPt : tgtPt
            return (
              <div
                key={`anchor-${which}`}
                className="nopan nodrag"
                style={{
                  position: 'absolute',
                  transform: `translate(-50%, -50%) translate(${pt.x}px,${pt.y}px)`,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#3b82f6',
                  border: '1.5px solid white',
                  pointerEvents: 'all',
                  cursor: anchorDragging === which ? 'grabbing' : 'grab',
                  zIndex: 10,
                }}
                onPointerDown={(e) => handleEndpointPointerDown(e, which)}
              />
            )
          })}
        </EdgeLabelRenderer>
      )}
    </>
  )
}
