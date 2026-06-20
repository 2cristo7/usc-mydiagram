import { EdgeLabelRenderer, useInternalNode, type EdgeProps } from '@xyflow/react'

type SequenceMessageData = {
  x1: number
  x2: number
  y: number
}

// Centro X en vivo de un nodo lifeline (su línea está centrada en la caja de 16px).
// Si aún no está medido/montado, devuelve undefined para caer al valor estático.
function liveCenterX(node: ReturnType<typeof useInternalNode>): number | undefined {
  if (!node) return undefined
  const w = node.measured?.width ?? 16
  return node.internals.positionAbsolute.x + w / 2
}

/**
 * Renders a horizontal sequence-diagram message arrow.
 *
 * React Flow's source/target coordinates are intentionally IGNORED — the edge
 * would otherwise route to the actor header (y≈0).  Instead we use data.x1,
 * data.x2 (lifeline center X values) and data.y (chronological row Y) which
 * are set by sequenceLayout and represent the true canvas coordinates.
 *
 * The SVG viewport is the full ReactFlow canvas, so absolute canvas coords map
 * 1-to-1 to the SVG coordinate space — no extra transform needed.
 */
export function SequenceMessageEdge({ source, target, data, label, markerEnd }: EdgeProps) {
  const { x1: dx1 = 0, x2: dx2 = 0, y = 0 } = (data ?? {}) as Partial<SequenceMessageData>

  // X en vivo desde los nodos lifeline conectados: al arrastrar el actor en
  // horizontal, sus lifelines (hijas) se mueven y el mensaje los sigue en el acto.
  // Fallback al valor estático del layout mientras los nodos no estén montados.
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  const x1 = liveCenterX(sourceNode) ?? dx1
  const x2 = liveCenterX(targetNode) ?? dx2

  const labelX = (x1 + x2) / 2
  const labelY = y

  // Ancho máximo de la etiqueta: ~80% del tramo de la flecha, acotado, para que
  // el texto largo envuelva en varias líneas (en vez de truncarse con puntos
  // suspensivos) sin invadir las lifelines vecinas.
  const span = Math.abs(x2 - x1)
  const labelMaxW = Math.max(120, Math.min(span - 24, 320))

  const dPath = `M ${x1} ${y} L ${x2} ${y}`

  return (
    <>
      <path
        d={dPath}
        fill="none"
        stroke="var(--color-ink)"
        strokeWidth={2}
        markerEnd={markerEnd}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -100%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              maxWidth: labelMaxW,
              whiteSpace: 'normal',
              overflowWrap: 'anywhere',
              textAlign: 'center',
              lineHeight: 1.25,
            }}
            className="text-xs font-mono font-semibold text-[var(--color-ink)] bg-[var(--color-bg)] px-1 border border-[var(--color-ink)]"
            title={String(label)}
          >
            {String(label)}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
