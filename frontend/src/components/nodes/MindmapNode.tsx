import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

type MindmapData = { label: string; attributes: string[] }
type MindmapNodeType = Node<MindmapData, 'mindmap'>

const ACCENT_COLORS = [
  'var(--color-accent)',
  'var(--color-accent-2)',
  'var(--color-accent-3)',
  '#a855f7',
  'var(--color-warn)',
]

export function MindmapNode({ data, id }: NodeProps<MindmapNodeType>) {
  const { label } = data
  const colorIdx = id.charCodeAt(0) % ACCENT_COLORS.length
  const color = ACCENT_COLORS[colorIdx]

  return (
    <div
      className="px-4 py-2 border-[3px] border-[var(--color-ink)] shadow-[var(--shadow-brutal)] font-semibold text-sm text-white text-center"
      style={{ backgroundColor: color, borderRadius: 9999 }}
    >
      {label}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
