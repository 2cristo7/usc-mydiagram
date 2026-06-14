import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

type LifelineData = { height: number }
type LifelineNodeType = Node<LifelineData, 'lifeline'>

/**
 * Vertical dashed lifeline for sequence diagrams.
 *
 * Invisible source/target handles are added so that React Flow can connect
 * sequenceMessage edges between lifeline nodes without console warnings.
 * The SequenceMessageEdge renderer ignores the handle positions entirely and
 * uses data.x1/x2/y for its own coordinates.
 */
export function LifelineNode({ data }: NodeProps<LifelineNodeType>) {
  const height = data.height ?? 200
  return (
    <div
      className="flex justify-center pointer-events-none"
      style={{ width: 16, height }}
    >
      {/* Hidden handles — edges connect here but render using explicit coords */}
      <Handle
        type="source"
        position={Position.Right}
        style={{ opacity: 0, pointerEvents: 'none', width: 1, height: 1 }}
      />
      <Handle
        type="target"
        position={Position.Left}
        style={{ opacity: 0, pointerEvents: 'none', width: 1, height: 1 }}
      />
      <div
        className="border-l-[2px] border-dashed border-[var(--color-ink)] h-full opacity-40"
        style={{ width: 0 }}
      />
    </div>
  )
}
