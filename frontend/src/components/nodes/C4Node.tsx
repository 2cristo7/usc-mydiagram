import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { NodeType } from '../../types'

type C4Data = { label: string; nodeType: NodeType }
type C4NodeType = Node<C4Data, 'c4'>

const C4_COLORS: Partial<Record<NodeType, string>> = {
  person: 'var(--color-accent-2)',
  system: 'var(--color-accent-3)',
  container: 'var(--color-warn)',
  component: '#a855f7',
}

const C4_ICONS: Partial<Record<NodeType, string>> = {
  person: '👤',
  actor: '👤',
  system: '💻',
  container: '📦',
  component: '⚙️',
}

export function C4Node({ data }: NodeProps<C4NodeType>) {
  const { label, nodeType } = data
  const color = C4_COLORS[nodeType] ?? 'var(--color-accent)'
  const icon = C4_ICONS[nodeType] ?? ''

  return (
    <div className="bg-[var(--color-surface)] border-[3px] border-[var(--color-ink)] shadow-[var(--shadow-brutal)] rounded-[var(--radius)] min-w-[120px]">
      <div
        className="px-3 py-1 border-b-[3px] border-[var(--color-ink)] text-xs font-semibold text-white text-center"
        style={{ backgroundColor: color }}
      >
        {nodeType}
      </div>
      <div className="px-3 py-2 text-center">
        {icon && <div className="text-2xl mb-1">{icon}</div>}
        <div className="font-semibold text-sm text-[var(--color-ink)]">{label}</div>
      </div>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
