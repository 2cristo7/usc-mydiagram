import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { useInlineEdit } from '../../hooks/useInlineEdit'
import { useStore } from '../../store'

type UseCaseData = { label: string }
type UseCaseNodeType = Node<UseCaseData, 'useCase'>

// Nodo caso de uso UML: elipse con el texto centrado, handles en los cuatro lados.
export function UseCaseNode({ data, id, selected }: NodeProps<UseCaseNodeType>) {
  const updateNode = useStore((s) => s.updateNode)
  const { isEditing, inputProps, containerProps } = useInlineEdit({
    initialValue: data.label,
    onCommit: (newLabel) => updateNode(id, { label: newLabel }),
    selected,
    nodeId: id,
  })

  return (
    <div
      className={`relative flex items-center justify-center bg-[var(--color-surface)] border-[3px] border-[var(--color-ink)] shadow-[var(--shadow-brutal)] px-6 py-3 min-w-[120px] min-h-[52px] text-center ${containerProps.className}`}
      style={{ borderRadius: '50%' }}
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
        <span className="text-sm font-semibold text-[var(--color-ink)] leading-tight">{data.label}</span>
      )}
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
