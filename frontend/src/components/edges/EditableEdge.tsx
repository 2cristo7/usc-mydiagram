import { useRef, useState, useLayoutEffect } from 'react'
import {
  EdgeLabelRenderer,
  useInternalNode,
  type EdgeProps,
} from '@xyflow/react'
import { useInlineEdit } from '../../hooks/useInlineEdit'
import { useStore } from '../../store'
import { useUiStore } from '../../store/ui'
import { getFloatingAnchor } from '../../ui/utils/getFloatingAnchor'
import { getWaypointPath } from '../../ui/utils/getWaypointPath'
import { snapPoint } from '../../ui/utils/grid'
import { useEdgeEditing } from './useEdgeEditing'
import type { EdgeVisualData } from '../../types'

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
  const shape = edgeData.shape ?? 'elbow'
  const strokeStyle = edgeData.strokeStyle ?? 'normal'
  const strokeColor = edgeData.strokeColor ?? 'var(--color-ink)'
  const strokeW = edgeData.strokeWidth ?? 2
  const arrowStart = edgeData.sourceArrow ?? false
  const arrowEnd = edgeData.targetArrow ?? true

  const updateEdge = useStore((s) => s.updateEdge)
  const gridEnabled = useUiStore((s) => s.gridEnabled)

  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)

  // Extremos por defecto: anclaje flotante automático (intersección borde-borde).
  // Con el grid activo se snappean en ambos ejes para que las aristas rectas
  // corran por las líneas del grid.
  const srcFloating = sourceNode && targetNode
    ? getFloatingAnchor(sourceNode as never, targetNode as never)
    : null
  const tgtFloating = sourceNode && targetNode
    ? getFloatingAnchor(targetNode as never, sourceNode as never)
    : null
  const rawDefaultSrc = srcFloating ?? { x: sourceX, y: sourceY }
  const rawDefaultTgt = tgtFloating ?? { x: targetX, y: targetY }
  const defaultSrcPt = gridEnabled ? snapPoint(rawDefaultSrc) : rawDefaultSrc
  const defaultTgtPt = gridEnabled ? snapPoint(rawDefaultTgt) : rawDefaultTgt

  const {
    srcPt,
    tgtPt,
    waypoints,
    corners,
    editingLayer,
    handleEdgePointerDown,
    handlePathDoubleClick,
    handleLabelPointerDown,
  } = useEdgeEditing({
    id,
    source,
    target,
    data: edgeData,
    selected,
    defaultSrcPt,
    defaultTgtPt,
    hasLabel: label !== '',
    labelT,
    segmentEditing: shape === 'elbow',
  })

  // En 'elbow' renderizamos desde las MISMAS esquinas que usan las píldoras
  // (ruteo direccional con codo perpendicular en los extremos), de modo que los
  // handles caen siempre exactamente sobre la línea. Curva/recta no tienen modelo
  // de segmentos: trazan directamente entre extremos y waypoints.
  const [edgePath, labelX, labelY] =
    shape === 'elbow'
      ? getWaypointPath(
          corners[0] ?? srcPt,
          corners[corners.length - 1] ?? tgtPt,
          corners.slice(1, -1),
          'elbow'
        )
      : getWaypointPath(srcPt, tgtPt, waypoints, shape)

  const strokeDasharray =
    strokeStyle === 'dashed' ? '8 4' :
    strokeStyle === 'dotted' ? '2 4' :
    undefined

  const computedMarkerStart = arrowStart ? 'url(#arrowReverse)' : undefined
  const computedMarkerEnd = arrowEnd ? 'url(#arrow)' : undefined

  const pathRef = useRef<SVGPathElement>(null)
  const [labelPos, setLabelPos] = useState({ x: labelX, y: labelY })

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

  // Doble clic sobre la línea: en elbow crea una esquina; en curva/recta sigue
  // editando la etiqueta (allí no hay modelo de segmentos).
  const onPathDoubleClick = (e: React.MouseEvent) => {
    if (shape === 'elbow') handlePathDoubleClick(e)
    else startEditing()
  }

  const showLabel = label !== '' || isEditing

  return (
    <>
      {/* wide invisible hit area for easier double-click / drag targeting.
          nopan evita que React Flow panee el canvas al agarrar la arista. */}
      <path
        className="nopan"
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onPointerDown={handleEdgePointerDown}
        onDoubleClick={onPathDoubleClick}
      />
      {/* visible path */}
      <path
        ref={pathRef}
        className="nopan"
        d={edgePath}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeW}
        strokeDasharray={strokeDasharray}
        markerEnd={computedMarkerEnd}
        markerStart={computedMarkerStart}
        style={style}
        onPointerDown={handleEdgePointerDown}
        onDoubleClick={onPathDoubleClick}
      />
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
            onPointerDown={(e) => {
              if (isEditing) return
              handleLabelPointerDown(e, pathRef.current)
            }}
          >
            {isEditing ? (
              <input
                {...inputProps}
                className="bg-transparent border-0 outline-none text-sm font-[var(--font-sans)] min-w-[1.5rem]"
              />
            ) : (
              label
            )}
          </div>
        </EdgeLabelRenderer>
      )}
      {editingLayer}
    </>
  )
}
