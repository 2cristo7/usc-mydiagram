import { EdgeLabelRenderer, type EdgeProps } from '@xyflow/react'

type SequenceMessageData = {
  x1: number
  x2: number
  y: number
}

/**
 * Renders a horizontal sequence-diagram message arrow.
 *
 * React Flow's source/target coordinates are intentionally IGNORED — the edge
 * would otherwise route to the actor header (y≈0).  Instead we use data.x1,
 * data.x2 (lifeline center X values) and data.y (chronological row Y) which
 * are set by sequenceLayout and represent the true canvas coordinates.
 *
 * The SVG viewport is the full ReactFlow canvas, so absolute canvas coords map
 * 1-to-1 to the SVG coordinate space — no extra transform needed.
 */
export function SequenceMessageEdge({ data, label, markerEnd }: EdgeProps) {
  const { x1 = 0, x2 = 0, y = 0 } = (data ?? {}) as Partial<SequenceMessageData>

  // Determine left→right direction for label placement
  const goingRight = x2 >= x1
  const labelX = (x1 + x2) / 2
  const labelY = y

  const dPath = `M ${x1} ${y} L ${x2} ${y}`

  return (
    <>
      <path
        d={dPath}
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
              maxWidth: 180,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              direction: goingRight ? 'ltr' : 'rtl',
            }}
            className="text-xs font-mono font-semibold text-[var(--color-ink)] bg-[var(--color-bg)] px-1 border border-[var(--color-ink)]"
            title={String(label)}
          >
            {String(label)}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
