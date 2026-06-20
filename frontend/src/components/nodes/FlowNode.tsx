import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { NodeType } from '../../types'
import { useInlineEdit } from '../../hooks/useInlineEdit'
import { useStore } from '../../store'
import { decisionNodeSize } from '../../ui/utils/decisionNode'

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
    // Rombo de diagonal mayor HORIZONTAL: la caja del nodo se dimensiona para que
    // el texto (en varias líneas, sin rotar) quepa dentro. El rombo se inscribe en
    // la caja con los vértices en los puntos medios de los lados → coincide con la
    // geometría de anclaje de aristas (isDiamond en getFloatingAnchor) y los handles
    // caen exactamente en las puntas.
    const { width, height, lines } = decisionNodeSize(label)
    // Vértices del rombo, insetados 1.5px para que el trazo de 3px no se recorte.
    const pts = `${width / 2},1.5 ${width - 1.5},${height / 2} ${width / 2},${height - 1.5} 1.5,${height / 2}`
    // Polígono de selección, expandido ~5px hacia fuera (svg con overflow visible).
    const selPts = `${width / 2},-5 ${width + 5},${height / 2} ${width / 2},${height + 5} -5,${height / 2}`
    return (
      <div
        className={`relative flex items-center justify-center ${containerProps.className}`}
        style={{ width, height }}
        onDoubleClick={containerProps.onDoubleClick}
      >
        <svg
          className="absolute inset-0 overflow-visible"
          width={width}
          height={height}
          style={{ filter: 'drop-shadow(4px 4px 0 var(--color-ink))' }}
        >
          <polygon
            points={pts}
            fill="var(--color-warn)"
            stroke="var(--color-ink)"
            strokeWidth={3}
            strokeLinejoin="round"
          />
          {selected && (
            <polygon points={selPts} fill="none" stroke="var(--color-accent)" strokeWidth={3} strokeLinejoin="round" />
          )}
        </svg>
        {isEditing ? (
          <textarea
            {...inputProps}
            onFocus={(e) => e.target.select()}
            className="relative z-10 text-center text-sm font-bold leading-snug text-[var(--color-ink)] bg-transparent border-none outline-none resize-none px-2"
            style={{ width: width / 2 }}
            rows={lines.length}
          />
        ) : (
          <span
            className="relative z-10 text-center text-sm font-bold leading-snug text-[var(--color-ink)] whitespace-pre-line px-2"
            style={{ width: width / 2 }}
          >
            {lines.join('\n')}
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
