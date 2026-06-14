import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { useInlineEdit } from '../../hooks/useInlineEdit'
import { useStore } from '../../store'

type MindmapData = { label: string; attributes: string[] }
type MindmapNodeType = Node<MindmapData, 'mindmap'>

const ACCENT_COLORS = [
  'var(--color-accent)',
  'var(--color-accent-2)',
  'var(--color-accent-3)',
  '#a855f7',
  'var(--color-warn)',
]

export function MindmapNode({ data, id, selected }: NodeProps<MindmapNodeType>) {
  const { label } = data
  const colorIdx = id.charCodeAt(0) % ACCENT_COLORS.length
  const color = ACCENT_COLORS[colorIdx]
  const updateNode = useStore((s) => s.updateNode)
  const { isEditing, inputProps, containerProps } = useInlineEdit({
    initialValue: label,
    onCommit: (newLabel) => updateNode(id, { label: newLabel }),
    selected,
  })

  return (
    <div
      className={`px-4 py-2 border-[3px] border-[var(--color-ink)] shadow-[var(--shadow-brutal)] font-semibold text-sm text-white text-center ${containerProps.className}`}
      style={{ backgroundColor: color, borderRadius: 9999 }}
      onDoubleClick={containerProps.onDoubleClick}
    >
      {isEditing ? (
        <textarea
          {...inputProps}
          onFocus={(e) => e.target.select()}
          className="font-semibold text-sm text-white text-center bg-transparent border-none outline-none resize-none w-full"
          rows={1}
        />
      ) : (
        label
      )}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
