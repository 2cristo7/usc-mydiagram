import { EdgeLabelRenderer, Position, type EdgeProps } from '@xyflow/react'
import { useUiStore } from '../../store/ui'
import { snapValue } from '../../ui/utils/grid'
import { getWaypointPath } from '../../ui/utils/getWaypointPath'
import { useEdgeEditing } from './useEdgeEditing'
import type { EdgeVisualData } from '../../types'

type ArchEdgeData = EdgeVisualData & {
  edge_type?: string
}

// Snappea solo el eje en el que sale la arista, conservando el otro para que el
// extremo siga tocando el borde del nodo: en bordes Top/Bottom la arista viaja en
// vertical → snap X; en Left/Right viaja en horizontal → snap Y.
function snapAlongBorder(x: number, y: number, position: Position, enabled: boolean) {
  if (!enabled) return { x, y }
  return position === Position.Top || position === Position.Bottom
    ? { x: snapValue(x), y }
    : { x, y: snapValue(y) }
}

export function ArchitectureEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const edgeData = (data ?? {}) as ArchEdgeData
  const label = edgeData.label ?? ''
  const edgeType = edgeData.edge_type ?? 'calls'

  const isCalls = edgeType === 'calls'

  // Con el grid activo, snappeamos los extremos por defecto a la rejilla (solo en
  // su eje de salida) para que los tramos ortogonales del smoothstep corran por
  // las líneas del grid sin despegarse del nodo.
  const gridEnabled = useUiStore((s) => s.gridEnabled)
  const defaultSrcPt = snapAlongBorder(sourceX, sourceY, sourcePosition, gridEnabled)
  const defaultTgtPt = snapAlongBorder(targetX, targetY, targetPosition, gridEnabled)

  // El hook sustituye el extremo por defecto si el usuario fijó un anclaje
  // deslizándolo por el borde, aporta la capa de handles de edición y calcula las
  // esquinas ortogonales efectivas (respetando la dirección de salida del nodo).
  const {
    srcPt,
    tgtPt,
    corners,
    editingLayer,
    handleEdgePointerDown,
  } = useEdgeEditing({
    id,
    source,
    target,
    data: edgeData,
    selected,
    defaultSrcPt,
    defaultTgtPt,
    hasLabel: label !== '',
    labelT: edgeData.labelT,
    segmentEditing: true,
    sourcePosition,
    targetPosition,
  })

  // Renderizamos desde las MISMAS esquinas que usan las píldoras (elbow
  // redondeado), de modo que los handles caen siempre exactamente sobre la línea,
  // tanto en la ruta por defecto (por el centro, perpendicular al borde) como con
  // waypoints intermedios.
  const [edgePath, labelX, labelY] = getWaypointPath(
    corners[0] ?? srcPt,
    corners[corners.length - 1] ?? tgtPt,
    corners.slice(1, -1),
    'elbow'
  )

  const strokeDasharray = isCalls ? undefined : '8 4'
  const markerEnd = isCalls ? 'url(#arrow)' : 'url(#arrowDashed)'
  const strokeWidth = selected ? 2.5 : 2

  return (
    <>
      {/* Zona de click amplia invisible. nopan evita que React Flow panee el
          canvas al agarrar la arista. */}
      <path
        id={id}
        className="nopan"
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onPointerDown={handleEdgePointerDown}
      />
      {/* Trazo visible */}
      <path
        className="nopan"
        d={edgePath}
        fill="none"
        stroke="var(--color-ink)"
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        markerEnd={markerEnd}
        opacity={selected ? 1 : 0.85}
        onPointerDown={handleEdgePointerDown}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'none',
            }}
            className="bg-[var(--color-surface)] border border-[var(--color-ink)] px-1.5 py-0.5 text-xs font-medium text-[var(--color-ink)] shadow-sm"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
      {editingLayer}
    </>
  )
}
