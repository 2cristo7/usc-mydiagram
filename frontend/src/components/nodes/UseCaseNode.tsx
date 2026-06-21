import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { useCallback } from 'react'
import { useInlineEdit } from '../../hooks/useInlineEdit'
import { useStore } from '../../store'
import { USE_CASE_MAX_TEXT_W } from '../../ui/utils/diagramToFlow'

type UseCaseData = { label: string }
type UseCaseNodeType = Node<UseCaseData, 'useCase'>

// Tope de ancho del contenido = ancho de texto + chrome lateral (px-8 64 + borde 6).
// Con max-width el texto largo ENVUELVE a varias líneas y el nodo crece en vertical.
// El mismo cap alimenta useCaseNodeSize, así el layout dimensiona la caja «system»
// exactamente como se renderiza aquí.
const MAX_W = USE_CASE_MAX_TEXT_W + 70

// Crece el alto del textarea a su contenido (multilínea) en cada cambio.
function grow(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

// Nodo caso de uso UML: elipse con el texto centrado, handles en los cuatro lados.
// El texto largo se reparte en varias líneas y la elipse se alarga en vertical.
export function UseCaseNode({ data, id, selected }: NodeProps<UseCaseNodeType>) {
  const updateNode = useStore((s) => s.updateNode)
  const { isEditing, inputProps, containerProps } = useInlineEdit({
    initialValue: data.label,
    onCommit: (newLabel) => updateNode(id, { label: newLabel }),
    selected,
    nodeId: id,
  })

  // Compone el ref del hook (que mide el texto) con el autoajuste de alto.
  const textareaRef = useCallback((el: HTMLTextAreaElement | null) => {
    inputProps.ref(el)
    if (el) grow(el)
  }, [inputProps])

  return (
    <div
      className={`relative flex items-center justify-center bg-[var(--color-surface)] border-[3px] border-[var(--color-ink)] shadow-[var(--shadow-brutal)] px-8 py-4 min-w-[120px] min-h-[52px] text-center ${containerProps.className}`}
      style={{ borderRadius: '50%', maxWidth: MAX_W }}
      onDoubleClick={containerProps.onDoubleClick}
    >
      {isEditing ? (
        <textarea
          {...inputProps}
          ref={textareaRef}
          // Ocupa el ancho (capado) y crece en alto: ignora la medida de una línea
          // del hook para poder envolver igual que el texto estático.
          style={{ width: '100%' }}
          onInput={(e) => grow(e.currentTarget)}
          onFocus={(e) => e.target.select()}
          className="text-sm font-semibold text-[var(--color-ink)] text-center bg-transparent border-none outline-none resize-none w-full overflow-hidden whitespace-pre-wrap break-words"
          rows={1}
        />
      ) : (
        <span className="text-sm font-semibold text-[var(--color-ink)] leading-tight whitespace-pre-wrap break-words">{data.label}</span>
      )}
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
