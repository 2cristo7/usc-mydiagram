import type { ComponentType } from 'react'
import type { ConnectionLineComponentProps } from '@xyflow/react'
import { getWaypointPath } from '../../ui/utils/getWaypointPath'
import type { EdgeVisualData } from '../../types'

// Línea de previsualización mientras se arrastra una arista nueva desde un punto
// del nodo. React Flow dibuja por defecto una bezier suave; aquí la sustituimos
// por una con la MISMA forma que tendrá la arista resultante (codo/curva/recta),
// para que lo que el usuario ve durante el arrastre coincida con lo que crea.
export function makeConnectionLine(
  shape: NonNullable<EdgeVisualData['shape']>,
): ComponentType<ConnectionLineComponentProps> {
  return function ConnectionLine({ fromX, fromY, toX, toY }: ConnectionLineComponentProps) {
    const [path] = getWaypointPath({ x: fromX, y: fromY }, { x: toX, y: toY }, [], shape)
    return (
      <g>
        <path
          d={path}
          fill="none"
          stroke="var(--color-ink)"
          strokeWidth={2}
          markerEnd="url(#arrow)"
        />
        <circle cx={toX} cy={toY} r={3} fill="var(--color-accent)" stroke="var(--color-surface)" strokeWidth={1} />
      </g>
    )
  }
}
