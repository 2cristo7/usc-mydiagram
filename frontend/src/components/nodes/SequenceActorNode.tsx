import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

type ActorData = { label: string }
type ActorNodeType = Node<ActorData, 'sequenceActor'>

export function SequenceActorNode({ data }: NodeProps<ActorNodeType>) {
  return (
    <div className="flex flex-col items-center">
      <div className="bg-[var(--color-surface)] border-[3px] border-[var(--color-ink)] shadow-[var(--shadow-brutal)] px-4 py-2 text-sm font-semibold text-[var(--color-ink)] text-center min-w-[80px]">
        {data.label}
      </div>
      <Handle type="source" position={Position.Bottom} id="bottom-source" />
      <Handle type="target" position={Position.Bottom} id="bottom-target" />
    </div>
  )
}
