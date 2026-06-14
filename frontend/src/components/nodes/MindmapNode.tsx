import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { useInlineEdit } from '../../hooks/useInlineEdit'
import { useStore } from '../../store'

type MindmapData = {
  label: string
  attributes: string[]
  level?: number
  role?: 'root' | 'branch' | 'leaf'
  branchColor?: string
  angle?: number
}
type MindmapNodeType = Node<MindmapData, 'mindmap'>

// Variante semitransparente del color de rama para las hojas
function leafStyle(branchColor: string): React.CSSProperties {
  return {
    borderColor: branchColor,
    color: branchColor,
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderStyle: 'solid',
    borderRadius: 9999,
  }
}

export function MindmapNode({ data, id, selected }: NodeProps<MindmapNodeType>) {
  const { label, role = 'leaf', branchColor = '#3b82f6' } = data
  const updateNode = useStore((s) => s.updateNode)
  const { isEditing, inputProps, containerProps } = useInlineEdit({
    initialValue: label,
    onCommit: (newLabel) => updateNode(id, { label: newLabel }),
    selected,
  })

  const sharedEdit = (
    <textarea
      {...inputProps}
      onFocus={(e) => e.target.select()}
      className="bg-transparent border-none outline-none resize-none w-full text-center"
      style={{ color: 'inherit', font: 'inherit' }}
      rows={1}
    />
  )

  // Handle mínimos e invisibles: la geometría la decide el edge flotante
  const hiddenHandles = (
    <>
      <Handle
        type="source"
        position={Position.Left}
        style={{ opacity: 0, pointerEvents: 'none' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        style={{ opacity: 0, pointerEvents: 'none' }}
      />
    </>
  )

  if (role === 'root') {
    return (
      <div
        className={`px-6 py-3 border-[3px] border-[var(--color-ink)] shadow-[var(--shadow-brutal)] font-bold text-base text-white text-center ${containerProps.className}`}
        style={{ backgroundColor: 'var(--color-ink)', borderRadius: 9999, minWidth: 120 }}
        onDoubleClick={containerProps.onDoubleClick}
      >
        {isEditing ? sharedEdit : label}
        {hiddenHandles}
      </div>
    )
  }

  if (role === 'branch') {
    return (
      <div
        className={`px-4 py-2 border-[3px] border-[var(--color-ink)] shadow-[var(--shadow-brutal)] font-semibold text-sm text-white text-center ${containerProps.className}`}
        style={{ backgroundColor: branchColor, borderRadius: 9999 }}
        onDoubleClick={containerProps.onDoubleClick}
      >
        {isEditing ? sharedEdit : label}
        {hiddenHandles}
      </div>
    )
  }

  // leaf
  return (
    <div
      className={`px-3 py-1 font-normal text-xs text-center ${containerProps.className}`}
      style={leafStyle(branchColor)}
      onDoubleClick={containerProps.onDoubleClick}
    >
      {isEditing ? sharedEdit : label}
      {hiddenHandles}
    </div>
  )
}
