import type { NodeProps, Node } from '@xyflow/react'

type LifelineData = { height: number }
type LifelineNodeType = Node<LifelineData, 'lifeline'>

export function LifelineNode({ data }: NodeProps<LifelineNodeType>) {
  const height = data.height ?? 200
  return (
    <div
      className="flex justify-center pointer-events-none"
      style={{ width: 16, height }}
    >
      <div
        className="border-l-[2px] border-dashed border-[var(--color-ink)] h-full opacity-40"
        style={{ width: 0 }}
      />
    </div>
  )
}
