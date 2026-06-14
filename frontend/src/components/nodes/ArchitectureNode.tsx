import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { NodeType } from '../../types'
import { useInlineEdit } from '../../hooks/useInlineEdit'
import { useStore } from '../../store'

type ArchData = { label: string; nodeType: NodeType }
type ArchNodeType = Node<ArchData, 'architecture'>

const ARCH_COLORS: Partial<Record<NodeType, string>> = {
  service: 'var(--color-accent-2)',
  database: 'var(--color-accent-3)',
  queue: 'var(--color-warn)',
  gateway: '#a855f7',
}

const ARCH_ICONS: Partial<Record<NodeType, string>> = {
  service: '⚙️',
  database: '🗄️',
  queue: '📬',
  gateway: '🚪',
}

export function ArchitectureNode({ id, data, selected }: NodeProps<ArchNodeType>) {
  const { label, nodeType } = data
  const color = ARCH_COLORS[nodeType] ?? 'var(--color-accent)'
  const icon = ARCH_ICONS[nodeType] ?? '❓'
  const updateNode = useStore((s) => s.updateNode)

  const { isEditing, inputProps, containerProps } = useInlineEdit({
    initialValue: label,
    onCommit: (newLabel) => updateNode(id, { label: newLabel }),
    selected,
  })

  return (
    <div
      {...containerProps}
      className={`bg-[var(--color-surface)] border-[3px] border-[var(--color-ink)] shadow-[var(--shadow-brutal)] rounded-[var(--radius)] min-w-[120px] ${containerProps.className}`}
    >
      <div
        className="px-3 py-1 border-b-[3px] border-[var(--color-ink)] text-xs font-semibold text-white text-center"
        style={{ backgroundColor: color }}
      >
        {icon} {nodeType}
      </div>
      <div className="px-3 py-2 text-center">
        {isEditing ? (
          <input
            {...inputProps}
            className="text-sm font-semibold text-[var(--color-ink)] text-center bg-transparent border-b border-[var(--color-ink)] outline-none w-full"
          />
        ) : (
          <div className="text-sm font-semibold text-[var(--color-ink)] text-center">
            {label}
          </div>
        )}
      </div>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
