/**
 * Definiciones SVG de las puntas de flecha referenciadas por `EditableEdge`
 * (`url(#arrow)` para el extremo final, `url(#arrowReverse)` para el inicio).
 *
 * Los markers se resuelven por id a nivel de documento, así que basta con
 * montar este `<svg>` una sola vez en el canvas: React Flow renderiza las
 * aristas en su propio SVG, pero `url(#id)` apunta al mismo documento.
 *
 * `markerUnits="userSpaceOnUse"` mantiene el tamaño de la flecha constante en
 * coordenadas de flujo (no escala con el grosor del trazo).
 *
 * Marcadores disponibles:
 *  - #arrow          → flecha abierta (markerEnd genérico y para include/extend)
 *  - #arrowReverse   → idéntica para markerStart
 *  - #arrowHollow    → triángulo hueco UML (generalización / herencia de actores)
 */
export function EdgeMarkers() {
  return (
    <svg
      aria-hidden
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
    >
      <defs>
        <marker
          id="arrow"
          markerWidth={12}
          markerHeight={12}
          refX={9}
          refY={5}
          orient="auto-start-reverse"
          markerUnits="userSpaceOnUse"
        >
          <path d="M1,1 L9,5 L1,9" fill="none" stroke="var(--color-ink)" strokeWidth={1.5} />
        </marker>
        {/* Idéntico a #arrow: con orient="auto-start-reverse" el navegador lo
            invierte automáticamente al usarse como markerStart, apuntando hacia
            el nodo origen. */}
        <marker
          id="arrowReverse"
          markerWidth={12}
          markerHeight={12}
          refX={3}
          refY={5}
          orient="auto-start-reverse"
          markerUnits="userSpaceOnUse"
        >
          <path d="M1,1 L9,5 L1,9" fill="none" stroke="var(--color-ink)" strokeWidth={1.5} />
        </marker>
        {/* Triángulo hueco UML (generalización de actores — inherits).
            Relleno blanco para que el fondo del diagrama no se «filtre» por dentro. */}
        <marker
          id="arrowHollow"
          markerWidth={14}
          markerHeight={14}
          refX={11}
          refY={7}
          orient="auto-start-reverse"
          markerUnits="userSpaceOnUse"
        >
          <polygon
            points="1,1 13,7 1,13"
            fill="var(--color-surface)"
            stroke="var(--color-ink)"
            strokeWidth={1.5}
          />
        </marker>
      </defs>
    </svg>
  )
}
