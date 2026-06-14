import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { useInlineEdit } from '../../hooks/useInlineEdit'
import { useStore } from '../../store'

type UmlData = { label: string; stereotype?: string; attributes: string[] }
type UmlNode = Node<UmlData, 'umlClass'>

export function UmlClassNode({ id, data, selected }: NodeProps<UmlNode>) {
  const { label, stereotype, attributes } = data
  const methods = attributes?.filter((a) => a.match(/\(.*\)\s*:\s*\w+$/)) ?? []
  const attrs = attributes?.filter((a) => !a.match(/\(.*\)\s*:\s*\w+$/)) ?? []
  const updateNode = useStore((s) => s.updateNode)

  const { isEditing, inputProps, containerProps } = useInlineEdit({
    initialValue: label,
    onCommit: (newLabel) => updateNode(id, { label: newLabel }),
    selected,
    nodeId: id,
  })

  return (
    <div
      {...containerProps}
      className={`bg-[var(--color-surface)] border-[3px] border-[var(--color-ink)] shadow-[var(--shadow-brutal)] min-w-[160px] ${containerProps.className}`}
    >
      <div className="text-center px-3 py-1.5 border-b-[3px] border-[var(--color-ink)]">
        {stereotype && (
          <div className="text-xs text-[var(--color-ink)]/60">«{stereotype}»</div>
        )}
        {isEditing ? (
          <input
            {...inputProps}
            className="font-bold text-sm text-[var(--color-ink)] bg-transparent border-none outline-none text-center w-full"
          />
        ) : (
          <div className="font-bold text-sm text-[var(--color-ink)]">{label}</div>
        )}
      </div>
      <div className="px-3 py-1.5 border-b-[3px] border-[var(--color-ink)] min-h-[28px]">
        {attrs.map((a, i) => (
          <div key={i} className="text-xs font-mono text-[var(--color-ink)] py-0.5">
            {a}
          </div>
        ))}
      </div>
      <div className="px-3 py-1.5 min-h-[28px]">
        {methods.map((m, i) => (
          <div key={i} className="text-xs font-mono text-[var(--color-ink)] py-0.5">
            {m}
          </div>
        ))}
      </div>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
