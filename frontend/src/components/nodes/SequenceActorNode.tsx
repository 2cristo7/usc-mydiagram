import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { useInlineEdit } from '../../hooks/useInlineEdit'
import { useStore } from '../../store'

type ActorData = { label: string }
type ActorNodeType = Node<ActorData, 'sequenceActor'>

export function SequenceActorNode({ data, id, selected }: NodeProps<ActorNodeType>) {
  const updateNode = useStore((s) => s.updateNode)
  const { isEditing, inputProps, containerProps } = useInlineEdit({
    initialValue: data.label,
    onCommit: (newLabel) => updateNode(id, { label: newLabel }),
    selected,
  })

  return (
    <div
      className={`flex flex-col items-center ${containerProps.className}`}
      onDoubleClick={containerProps.onDoubleClick}
    >
      <div className="bg-[var(--color-surface)] border-[3px] border-[var(--color-ink)] shadow-[var(--shadow-brutal)] px-4 py-2 text-sm font-semibold text-[var(--color-ink)] text-center min-w-[80px]">
        {isEditing ? (
          <textarea
            {...inputProps}
            onFocus={(e) => e.target.select()}
            className="text-sm font-semibold text-[var(--color-ink)] text-center bg-transparent border-none outline-none resize-none w-full"
            rows={1}
          />
        ) : (
          data.label
        )}
      </div>
      <Handle type="source" position={Position.Bottom} id="bottom-source" />
      <Handle type="target" position={Position.Bottom} id="bottom-target" />
    </div>
  )
}
