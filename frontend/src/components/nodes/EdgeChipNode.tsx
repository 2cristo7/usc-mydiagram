// Nodo "ficha" que representa una arista durante la fase de almacén (staging).
// No tiene handles de conexión: es puramente visual, para que el usuario vea
// las aristas que van llegando por streaming antes del ensamblaje del diagrama.
import type { NodeProps, Node } from '@xyflow/react'

type EdgeChipData = {
  sourceLabel: string
  targetLabel: string
  edgeLabel: string
}
type EdgeChipNodeType = Node<EdgeChipData, 'edgeChip'>

export function EdgeChipNode({ data }: NodeProps<EdgeChipNodeType>) {
  const { sourceLabel, targetLabel, edgeLabel } = data

  return (
    <div className="flex flex-col items-start gap-1 px-3 py-2 bg-[var(--color-surface)] border-[2px] border-[var(--color-ink)] border-dashed shadow-[2px_2px_0px_var(--color-ink)] max-w-[160px]">
      <span className="text-[10px] font-mono text-[var(--color-ink)]/60 uppercase tracking-wide leading-none">
        arista
      </span>
      <span className="text-xs font-semibold text-[var(--color-ink)] leading-tight break-words">
        {sourceLabel} → {targetLabel}
      </span>
      {edgeLabel && (
        <span className="text-[10px] text-[var(--color-ink)]/70 italic leading-none">
          {edgeLabel}
        </span>
      )}
    </div>
  )
}
