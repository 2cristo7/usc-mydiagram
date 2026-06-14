import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { NodeType } from '../../types'
import { useInlineEdit } from '../../hooks/useInlineEdit'
import { useStore } from '../../store'

type FlowData = { label: string; nodeType: NodeType }
type FlowNodeType = Node<FlowData, 'flow'>

export function FlowNode({ data, id, selected }: NodeProps<FlowNodeType>) {
  const { label, nodeType } = data
  const updateNode = useStore((s) => s.updateNode)
  const { isEditing, inputProps, containerProps } = useInlineEdit({
    initialValue: label,
    onCommit: (newLabel) => updateNode(id, { label: newLabel }),
    selected,
    nodeId: id,
  })

  if (nodeType === 'decision') {
    return (
      <div
        className={`relative flex items-center justify-center ${containerProps.className}`}
        style={{ width: 128, height: 128 }}
        onDoubleClick={containerProps.onDoubleClick}
      >
        <div className="absolute inset-0 border-[3px] border-[var(--color-ink)] bg-[var(--color-warn)] shadow-[var(--shadow-brutal)] rotate-45" />
        {isEditing ? (
          <textarea
            {...inputProps}
            onFocus={(e) => e.target.select()}
            className="relative z-10 text-center text-xs font-bold leading-tight text-[var(--color-ink)] bg-transparent border-none outline-none resize-none w-20 px-2"
            rows={2}
          />
        ) : (
          <span className="relative z-10 text-center text-xs font-bold px-2 leading-tight text-[var(--color-ink)]">
            {label}
          </span>
        )}
        <Handle type="target" position={Position.Top} />
        <Handle type="source" position={Position.Bottom} />
        <Handle type="source" position={Position.Left} />
        <Handle type="source" position={Position.Right} />
      </div>
    )
  }

  if (nodeType === 'terminator') {
    return (
      <div
        className={`flex items-center px-6 py-3 bg-[var(--color-danger)] border-[3px] border-[var(--color-ink)] shadow-[var(--shadow-brutal)] rounded-full ${containerProps.className}`}
        onDoubleClick={containerProps.onDoubleClick}
      >
        {isEditing ? (
          <textarea
            {...inputProps}
            onFocus={(e) => e.target.select()}
            className="text-white font-bold text-sm bg-transparent border-none outline-none resize-none text-center"
            rows={1}
          />
        ) : (
          <span className="text-white font-bold text-sm">{label}</span>
        )}
        <Handle type="target" position={Position.Top} />
        <Handle type="source" position={Position.Bottom} />
        <Handle type="target" position={Position.Left} />
        <Handle type="source" position={Position.Right} />
      </div>
    )
  }

  return (
    <div
      className={`px-4 py-3 bg-[var(--color-accent-3)] border-[3px] border-[var(--color-ink)] shadow-[var(--shadow-brutal)] rounded-[var(--radius)] ${containerProps.className}`}
      onDoubleClick={containerProps.onDoubleClick}
    >
      {isEditing ? (
        <textarea
          {...inputProps}
          onFocus={(e) => e.target.select()}
          className="text-white font-semibold text-sm bg-transparent border-none outline-none resize-none text-center w-full"
          rows={1}
        />
      ) : (
        <span className="text-white font-semibold text-sm">{label}</span>
      )}
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
