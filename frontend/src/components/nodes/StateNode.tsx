import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { useInlineEdit } from '../../hooks/useInlineEdit'
import { useStore } from '../../store'

type StateData = { label: string; attributes: string[] }
type StateNodeType = Node<StateData, 'state'>

function isInitial(label: string) {
  return /^(start|inicio|initial)$/i.test(label.trim())
}

function isFinal(label: string) {
  return /^(end|fin|final)$/i.test(label.trim())
}

export function StateNode({ data, id, selected }: NodeProps<StateNodeType>) {
  const { label } = data
  const updateNode = useStore((s) => s.updateNode)
  const { isEditing, inputProps, containerProps } = useInlineEdit({
    initialValue: label,
    onCommit: (newLabel) => updateNode(id, { label: newLabel }),
    selected,
    nodeId: id,
  })

  if (isInitial(label)) {
    return (
      <div className="flex items-center justify-center w-10 h-10 rounded-full bg-[var(--color-ink)]">
        <Handle type="source" position={Position.Bottom} />
        <Handle type="source" position={Position.Right} />
      </div>
    )
  }

  if (isFinal(label)) {
    return (
      <div className="flex items-center justify-center w-10 h-10 rounded-full border-[3px] border-[var(--color-ink)]">
        <div className="w-6 h-6 rounded-full bg-[var(--color-ink)]" />
        <Handle type="target" position={Position.Top} />
        <Handle type="target" position={Position.Left} />
      </div>
    )
  }

  return (
    <div
      className={`bg-[var(--color-surface)] border-[3px] border-[var(--color-ink)] shadow-[var(--shadow-brutal)] px-4 py-2 min-w-[120px] text-center ${containerProps.className}`}
      style={{ borderRadius: 12 }}
      onDoubleClick={containerProps.onDoubleClick}
    >
      {isEditing ? (
        <textarea
          {...inputProps}
          onFocus={(e) => e.target.select()}
          className="text-sm font-semibold text-[var(--color-ink)] text-center bg-transparent border-none outline-none resize-none w-full"
          rows={1}
        />
      ) : (
        <span className="text-sm font-semibold text-[var(--color-ink)]">{label}</span>
      )}
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
