import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { NodeType } from '../../types'
import { useInlineEdit } from '../../hooks/useInlineEdit'
import { useStore } from '../../store'

type FlowData = { label: string; nodeType: NodeType }
type FlowNodeType = Node<FlowData, 'flow'>

// Outline de selección que SIGUE la forma: se aplica al elemento con la forma
// real (el rombo rotado, la píldora, el rect), no al bounding box cuadrado del
// nodo, así el resalte de selección coincide con el contorno visible. El outline
// hereda el border-radius/rotación del elemento, de modo que en la píldora es
// una píldora y en el rombo rotado es un rombo. El outline global de
// `.react-flow__node.selected` se anula para los nodos de flujo en index.css.
const selOutline = (selected?: boolean) =>
  selected ? ' outline outline-[3px] outline-offset-[3px] outline-[color:var(--color-accent)]' : ''

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
        style={{ width: 181, height: 181 }}
        onDoubleClick={containerProps.onDoubleClick}
      >
        {/* Rombo: cuadrado de 128 rotado 45°, centrado, cuyo bounding box (128·√2
            ≈ 181) llena exactamente el box del nodo → el hitbox coincide con el
            rombo visible y los handles caen en sus puntas. */}
        <div className={`absolute left-1/2 top-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rotate-45 border-[3px] border-[var(--color-ink)] bg-[var(--color-warn)] shadow-[var(--shadow-brutal)]${selOutline(selected)}`} />
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
        className={`flex items-center px-6 py-3 bg-[var(--color-danger)] border-[3px] border-[var(--color-ink)] shadow-[var(--shadow-brutal)] rounded-full ${containerProps.className}${selOutline(selected)}`}
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
      className={`px-4 py-3 bg-[var(--color-accent-3)] border-[3px] border-[var(--color-ink)] shadow-[var(--shadow-brutal)] rounded-[var(--radius)] ${containerProps.className}${selOutline(selected)}`}
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
