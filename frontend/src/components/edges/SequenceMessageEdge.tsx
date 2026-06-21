import { useState } from 'react'
import {
  EdgeLabelRenderer,
  useInternalNode,
  useReactFlow,
  useStoreApi,
  type EdgeProps,
} from '@xyflow/react'
import { useStore } from '../../store'
import { useInlineEdit } from '../../hooks/useInlineEdit'
import { beginDragCursor, endDragCursor } from '../../ui/utils/dragCursor'
import { SELF_LOOP_H } from '../../ui/utils/sequenceLayout'

type SequenceMessageData = {
  x1: number
  x2: number
  y: number
  self?: boolean
  reply?: boolean
}

// Umbral (px de pantalla) para distinguir un clic de un arrastre vertical.
const DRAG_THRESHOLD = 4
// Geometría del bucle del self-message (debe encajar con sequenceLayout).
const LOOP_W = 38 // ancho del saliente a la derecha de la lifeline
// Media anchura de la barra de activación (16px, centrada en la lifeline): la flecha
// llega/parte del BORDE de la caja, no del centro de la lifeline.
const ACT_HALF = 8

// Centro X en vivo de un nodo lifeline (su línea está centrada en la caja de 16px).
// Si aún no está medido/montado, devuelve undefined para caer al valor estático.
function liveCenterX(node: ReturnType<typeof useInternalNode>): number | undefined {
  if (!node) return undefined
  const w = node.measured?.width ?? 16
  return node.internals.positionAbsolute.x + w / 2
}

/**
 * Renders a sequence-diagram message.
 *
 * React Flow's source/target coordinates are intentionally IGNORED — the edge
 * would otherwise route to the actor header (y≈0).  Instead we use data.x1,
 * data.x2 (lifeline center X values) and data.y (chronological row Y) which
 * are set by sequenceLayout and represent the true canvas coordinates.
 *
 * Un mensaje normal es una flecha horizontal entre dos lifelines. Un self-message
 * (origen = destino → data.self) se dibuja como un bucle a la derecha de la
 * lifeline que retorna sobre la barra de activación anidada.
 *
 * Interacción: arrastrar el mensaje en VERTICAL lo reordena en la secuencia (el
 * eje vertical es el tiempo); doble clic sobre la etiqueta la edita en sitio.
 */
export function SequenceMessageEdge({ id, source, target, data, label, selected }: EdgeProps) {
  const { x1: dx1 = 0, x2: dx2 = 0, y: dy = 0, self: isSelf = false, reply: isReply = false } =
    (data ?? {}) as Partial<SequenceMessageData>

  const updateEdge = useStore((s) => s.updateEdge)
  const moveEdge = useStore((s) => s.moveEdge)
  const { screenToFlowPosition } = useReactFlow()
  const rfStore = useStoreApi()

  // X en vivo desde los nodos lifeline conectados: al arrastrar el actor en
  // horizontal, sus lifelines (hijas) se mueven y el mensaje los sigue en el acto.
  // Fallback al valor estático del layout mientras los nodos no estén montados.
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  const x1 = liveCenterX(sourceNode) ?? dx1
  const x2 = liveCenterX(targetNode) ?? dx2

  // Y de preview durante el arrastre: el mensaje sigue al cursor en vivo; al soltar
  // se reordena (moveEdge) y el re-layout fija la Y definitiva.
  const [dragY, setDragY] = useState<number | null>(null)
  const y = dragY ?? dy

  // Edición inline de la etiqueta (doble clic). El label de secuencia vive en el
  // campo de contrato edge.label (nivel superior), no en data.label.
  const { isEditing, inputProps, containerProps } = useInlineEdit({
    initialValue: String(label ?? ''),
    onCommit: (v) => updateEdge(id, { label: v }),
    selected,
  })

  // Arrastre vertical → reordenar el mensaje. Requiere que el edge esté
  // seleccionado (el primer clic selecciona; a partir de ahí se arrastra), igual
  // que el resto de aristas editables.
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!selected || e.button !== 0) return
    e.stopPropagation()
    const startClientY = e.clientY
    let dragging = false

    const onMove = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.abs(ev.clientY - startClientY) < DRAG_THRESHOLD) return
        dragging = true
        beginDragCursor()
      }
      setDragY(screenToFlowPosition({ x: ev.clientX, y: ev.clientY }).y)
    }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (dragging) {
        endDragCursor()
        const fy = screenToFlowPosition({ x: ev.clientX, y: ev.clientY }).y
        // Índice de inserción = nº de OTROS mensajes cuya fila queda por encima del
        // cursor. El orden visual (por data.y) coincide con el del array de aristas.
        const newIndex = [...rfStore.getState().edges]
          .filter((edge) => edge.type === 'sequenceMessage' && edge.id !== id)
          .filter((edge) => ((edge.data as { y?: number }).y ?? 0) < fy).length
        moveEdge(id, newIndex)
      }
      setDragY(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Trazado del mensaje. La flecha NO llega al centro de la lifeline sino al BORDE de
  // la barra de activación (centrada, media anchura ACT_HALF), de modo que aterriza en
  // la esquina superior de la caja destino. Normal: línea horizontal de borde a borde.
  // Self: bucle a la derecha que sale y retorna al borde derecho de la caja (cx+ACT_HALF).
  const cx = x1
  const dir = x2 >= x1 ? 1 : -1
  const loopRight = cx + LOOP_W
  const loopBottom = y + SELF_LOOP_H
  const landX = cx + ACT_HALF // borde derecho de la caja (centrada en cx)
  const dPath = isSelf
    ? `M ${landX} ${y} L ${loopRight} ${y} L ${loopRight} ${loopBottom} L ${landX} ${loopBottom}`
    : `M ${x1 + dir * ACT_HALF} ${y} L ${x2 - dir * ACT_HALF} ${y}`

  // Respuesta (retorno): línea discontinua + flecha abierta. Mensaje de llamada:
  // línea sólida + flecha rellena (estilo UML).
  const markerId = isReply ? 'arrow' : 'arrowFilled'
  const dashArray = isReply ? '6 4' : undefined

  // Posición de la etiqueta: a la derecha del bucle (self) o sobre el centro de la
  // flecha (normal).
  const labelX = isSelf ? cx + LOOP_W + 8 : (x1 + x2) / 2
  const labelY = isSelf ? y + SELF_LOOP_H / 2 : y
  const labelTransform = isSelf
    ? `translate(0, -50%) translate(${labelX}px,${labelY}px)`
    : `translate(-50%, -100%) translate(${labelX}px,${labelY}px)`

  // Ancho máximo de la etiqueta: ~80% del tramo de la flecha, acotado, para que
  // el texto largo envuelva en varias líneas sin invadir las lifelines vecinas.
  const span = Math.abs(x2 - x1)
  const labelMaxW = isSelf ? 200 : Math.max(120, Math.min(span - 24, 320))

  const accent = selected ? 'var(--color-accent)' : 'var(--color-ink)'

  return (
    <>
      {/* Trazo de interacción ancho e invisible: facilita seleccionar, abrir el
          menú contextual y arrastrar sobre una línea de solo 2px. */}
      <path
        d={dPath}
        fill="none"
        stroke="transparent"
        strokeWidth={12}
        style={{ cursor: selected ? 'ns-resize' : 'pointer', pointerEvents: 'stroke' }}
        onPointerDown={handlePointerDown}
      />
      <path
        d={dPath}
        fill="none"
        stroke={accent}
        strokeWidth={2}
        strokeDasharray={dashArray}
        markerEnd={`url(#${markerId})`}
        style={{ pointerEvents: 'none' }}
      />
      {(label || isEditing) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: labelTransform,
              pointerEvents: 'all',
              maxWidth: labelMaxW,
              whiteSpace: 'normal',
              overflowWrap: 'anywhere',
              textAlign: 'center',
              lineHeight: 1.25,
              cursor: selected && !isEditing ? 'ns-resize' : 'text',
            }}
            className={`text-xs font-mono font-semibold text-[var(--color-ink)] bg-[var(--color-bg)] px-1 border border-[var(--color-ink)] ${containerProps.className}`}
            title={String(label)}
            onDoubleClick={containerProps.onDoubleClick}
            onPointerDown={isEditing ? undefined : handlePointerDown}
          >
            {isEditing ? (
              <textarea
                {...inputProps}
                onFocus={(e) => e.target.select()}
                className="text-xs font-mono font-semibold text-[var(--color-ink)] text-center bg-transparent border-none outline-none resize-none w-full"
                rows={1}
              />
            ) : (
              String(label)
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
