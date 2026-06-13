import { EdgeLabelRenderer, getStraightPath, type EdgeProps } from '@xyflow/react'

export function SequenceMessageEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  label,
  markerEnd,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getStraightPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  })

  return (
    <>
      <path
        d={edgePath}
        fill="none"
        stroke="var(--color-ink)"
        strokeWidth={2}
        markerEnd={markerEnd}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -100%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="text-xs font-mono font-semibold text-[var(--color-ink)] bg-[var(--color-bg)] px-1 border border-[var(--color-ink)]"
          >
            {String(label)}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
