import { EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react'

type ArchEdgeData = {
  label?: string
  edge_type?: string
}

export function ArchitectureEdge({
  id,
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

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  })

  const strokeDasharray = isCalls ? undefined : '8 4'
  const markerEnd = isCalls ? 'url(#arrow)' : 'url(#arrowDashed)'
  const strokeWidth = selected ? 2.5 : 2

  return (
    <>
      {/* Zona de click amplia invisible */}
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
      />
      {/* Trazo visible */}
      <path
        d={edgePath}
        fill="none"
        stroke="var(--color-ink)"
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        markerEnd={markerEnd}
        opacity={selected ? 1 : 0.85}
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
    </>
  )
}
