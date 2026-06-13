import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { NodeType } from '../../types'

type FlowData = { label: string; nodeType: NodeType }
type FlowNodeType = Node<FlowData, 'flow'>

export function FlowNode({ data }: NodeProps<FlowNodeType>) {
  const { label, nodeType } = data

  if (nodeType === 'decision') {
    return (
      <div
        className="relative flex items-center justify-center"
        style={{ width: 128, height: 128 }}
      >
        <div className="absolute inset-0 border-[3px] border-[var(--color-ink)] bg-[var(--color-warn)] shadow-[var(--shadow-brutal)] rotate-45" />
        <span className="relative z-10 text-center text-xs font-bold px-2 leading-tight text-[var(--color-ink)]">
          {label}
        </span>
        <Handle type="target" position={Position.Top} />
        <Handle type="source" position={Position.Bottom} />
        <Handle type="source" position={Position.Left} />
        <Handle type="source" position={Position.Right} />
      </div>
    )
  }

  if (nodeType === 'terminator') {
    return (
      <div className="flex items-center px-6 py-3 bg-[var(--color-danger)] border-[3px] border-[var(--color-ink)] shadow-[var(--shadow-brutal)] rounded-full">
        <span className="text-white font-bold text-sm">{label}</span>
        <Handle type="target" position={Position.Top} />
        <Handle type="source" position={Position.Bottom} />
      </div>
    )
  }

  return (
    <div className="px-4 py-3 bg-[var(--color-accent-3)] border-[3px] border-[var(--color-ink)] shadow-[var(--shadow-brutal)] rounded-[var(--radius)]">
      <span className="text-white font-semibold text-sm">{label}</span>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
