import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { useInlineEdit } from '../../hooks/useInlineEdit'
import { useStore } from '../../store'

type TableData = { label: string; attributes: string[] }
type TableNodeType = Node<TableData, 'table'>

export function TableNode({ id, data, selected }: NodeProps<TableNodeType>) {
  const { label, attributes } = data
  const updateNode = useStore((s) => s.updateNode)

  const { isEditing, inputProps, containerProps } = useInlineEdit({
    initialValue: label,
    onCommit: (newLabel) => updateNode(id, { label: newLabel }),
    selected,
    nodeId: id,
  })

  return (
    <div className="bg-[var(--color-surface)] border-[3px] border-[var(--color-ink)] rounded-[var(--radius)] shadow-[var(--shadow-brutal)] min-w-[160px]">
      <div
        {...containerProps}
        className={`bg-[var(--color-accent)] px-3 py-1.5 border-b-[3px] border-[var(--color-ink)] ${containerProps.className}`}
      >
        {isEditing ? (
          <input
            {...inputProps}
            className="font-bold text-sm text-white bg-transparent border-none outline-none w-full"
          />
        ) : (
          <span className="font-bold text-sm text-white">{label}</span>
        )}
      </div>
      <div className="px-3 py-1.5">
        {attributes.map((attr, i) => {
          const isPK = attr.includes('PK')
          const isFK = attr.includes('FK')
          return (
            <div
              key={i}
              className="flex items-center gap-1 py-0.5 text-xs font-mono text-[var(--color-ink)]"
            >
              {isPK && <span title="Primary Key">🔑</span>}
              {isFK && !isPK && <span title="Foreign Key">🔗</span>}
              <span>{attr}</span>
            </div>
          )
        })}
      </div>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
