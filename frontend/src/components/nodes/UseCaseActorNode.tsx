import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { useInlineEdit } from '../../hooks/useInlineEdit'
import { useStore } from '../../store'

type ActorData = { label: string }
type UCActorNodeType = Node<ActorData, 'useCaseActor'>

// Monigote (stick figure) para diagramas de casos de uso UML.
// Distinto de SequenceActorNode: aquí el actor es una figura lateral (no cabecera
// de lifeline), tiene handles en los cuatro lados y su forma es el icono SVG estándar.
export function UseCaseActorNode({ data, id, selected }: NodeProps<UCActorNodeType>) {
  const updateNode = useStore((s) => s.updateNode)
  const { isEditing, inputProps, containerProps } = useInlineEdit({
    initialValue: data.label,
    onCommit: (newLabel) => updateNode(id, { label: newLabel }),
    selected,
    nodeId: id,
  })

  return (
    <div
      className={`flex flex-col items-center gap-1 ${containerProps.className}`}
      onDoubleClick={containerProps.onDoubleClick}
    >
      {/* Figura del monigote */}
      <svg
        width="48"
        height="64"
        viewBox="0 0 48 64"
        fill="none"
        stroke="var(--color-ink)"
        strokeWidth="3"
        strokeLinecap="round"
        aria-hidden="true"
      >
        {/* Cabeza */}
        <circle cx="24" cy="10" r="8" />
        {/* Cuerpo */}
        <line x1="24" y1="18" x2="24" y2="42" />
        {/* Brazos */}
        <line x1="6" y1="28" x2="42" y2="28" />
        {/* Pierna izquierda */}
        <line x1="24" y1="42" x2="10" y2="60" />
        {/* Pierna derecha */}
        <line x1="24" y1="42" x2="38" y2="60" />
      </svg>

      {/* Etiqueta */}
      <div className="text-xs font-semibold text-[var(--color-ink)] text-center max-w-[96px]">
        {isEditing ? (
          <textarea
            {...inputProps}
            onFocus={(e) => e.target.select()}
            className="text-xs font-semibold text-[var(--color-ink)] text-center bg-transparent border-none outline-none resize-none w-full"
            rows={1}
          />
        ) : (
          data.label
        )}
      </div>

      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
