import { useCallback } from 'react'
import {
  useReactFlow,
  useStore as useReactFlowStore,
  type FitViewOptions,
  type Rect,
  type Viewport,
} from '@xyflow/react'
import { useStore } from '../../store'

/**
 * Opciones de encuadre compartidas por TODOS los puntos que llaman a fitView
 * (la prop `fitView` del canvas al montar, el re-encuadre al cargar del
 * historial y el botón "Ajustar vista" del toolbar), para que el resultado sea
 * idéntico en los tres casos.
 *
 * - padding por lado: margen inferior amplio para que el contenido no quede
 *   tapado por el prompt flotante (abajo-centro) ni por el minimapa
 *   (abajo-derecha).
 * - maxZoom 1.0: topa la escala del encuadre. El layout radial produce bounding
 *   boxes de proporción variable que, en un lienzo apaisado, encajarían a zooms
 *   distintos; con el tope, todo diagrama que quepa a ≥1.0 se renderiza
 *   EXACTAMENTE a 1.0 → misma escala en pantalla entre diagramas.
 */
export const FIT_VIEW_OPTIONS: FitViewOptions = {
  padding: { top: '32px', right: '32px', left: '32px', bottom: '150px' },
  maxZoom: 1.0,
}

// Duración (ms) de la animación de encuadre para las llamadas imperativas
// (cargar del historial, botón de ajustar). El encuadre del montaje inicial NO
// la usa: en la primera pintura no hay vista previa desde la que animar.
// useFitDiagramView la inyecta como `duration` en cada llamada.
export const FIT_VIEW_DURATION = 400

// ── Encuadre con ANCLAJE SUPERIOR (diagramas de secuencia) ──────────────────
// Un diagrama de secuencia se lee de arriba abajo y SIEMPRE debe mostrar las
// cabeceras de los participantes (los "nodos de inicio"). El fitView nativo
// centra el contenido y, con la holgura inferior amplia que reservamos para el
// prompt flotante (150px), empuja el contenido hacia ARRIBA para honrar ese
// margen cuando el diagrama casi llena el alto → recorta las cabeceras. React
// Flow no sabe anclar arriba, así que calculamos el viewport a mano: fijamos el
// borde superior del contenido a SEQ_PAD_TOP y, si el diagrama no cabe entero,
// dejamos que sobresalga por ABAJO (preferimos perder el final del proceso antes
// que las cabeceras).
const SEQ_PAD_X = 32
const SEQ_PAD_TOP = 40
const SEQ_PAD_BOTTOM = 150 // misma reserva que FIT_VIEW_OPTIONS.bottom (prompt flotante)
const SEQ_MIN_ZOOM = 0.5   // = minZoom por defecto de React Flow
const SEQ_MAX_ZOOM = 1.0   // = maxZoom de FIT_VIEW_OPTIONS (misma escala entre diagramas)

/**
 * Viewport que ancla el borde superior del bounding box a SEQ_PAD_TOP y lo centra
 * en horizontal. El zoom es el de "caber entero" (limitado por ancho o alto)
 * topado a [SEQ_MIN_ZOOM, SEQ_MAX_ZOOM]; cuando el diagrama es más alto que el
 * lienzo a ese zoom, el anclaje superior garantiza que las cabeceras se vean.
 */
export function topAnchoredViewport(bounds: Rect, paneW: number, paneH: number): Viewport {
  const zoomX = (paneW - 2 * SEQ_PAD_X) / bounds.width
  const zoomY = (paneH - SEQ_PAD_TOP - SEQ_PAD_BOTTOM) / bounds.height
  const zoom = Math.max(SEQ_MIN_ZOOM, Math.min(zoomX, zoomY, SEQ_MAX_ZOOM))
  return {
    x: paneW / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: SEQ_PAD_TOP - bounds.y * zoom,
    zoom,
  }
}

/**
 * Devuelve una función de encuadre consciente del TIPO de diagrama: para los de
 * secuencia ancla la vista arriba (topAnchoredViewport); para el resto delega en
 * el fitView nativo con las opciones compartidas. La usan todos los puntos de
 * encuadre (carga del historial, montaje en vivo, botones del toolbar) para que
 * el comportamiento sea idéntico en todos ellos.
 */
export function useFitDiagramView() {
  const { fitView, getNodes, getNodesBounds, setViewport } = useReactFlow()
  const paneW = useReactFlowStore((s) => s.width)
  const paneH = useReactFlowStore((s) => s.height)
  const isSequence = useStore((s) => s.currentDiagram?.diagram_type === 'sequence')

  return useCallback(
    (opts?: { duration?: number }) => {
      if (isSequence && paneW > 0 && paneH > 0) {
        const nodes = getNodes()
        const bounds = nodes.length ? getNodesBounds(nodes) : null
        if (bounds && bounds.width > 0 && bounds.height > 0) {
          setViewport(topAnchoredViewport(bounds, paneW, paneH), { duration: opts?.duration })
          return
        }
      }
      fitView({ ...FIT_VIEW_OPTIONS, duration: opts?.duration })
    },
    [isSequence, paneW, paneH, fitView, getNodes, getNodesBounds, setViewport],
  )
}
