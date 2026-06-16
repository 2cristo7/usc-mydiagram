import type { FitViewOptions } from '@xyflow/react'

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
export const FIT_VIEW_DURATION = 400

export const FIT_VIEW_OPTIONS_ANIMATED: FitViewOptions = {
  ...FIT_VIEW_OPTIONS,
  duration: FIT_VIEW_DURATION,
}
