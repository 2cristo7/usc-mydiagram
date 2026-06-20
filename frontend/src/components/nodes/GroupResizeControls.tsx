import { NodeResizer } from '@xyflow/react'
import type { CSSProperties } from 'react'
import { useStore } from '../../store/index'

// Grosor (px) de la franja del perímetro que captura clics para seleccionar el
// contenedor. El interior queda transparente a eventos para no robarle el clic a
// los nodos hijos ni al paneo/selección sobre el canvas.
const RIM = 14

/**
 * Controles de redimensionado + selección compartidos por TODOS los contenedores
 * de grupo (architectureGroup, useCaseSystem, sequenceFragment). Render:
 *  - NodeResizer: tiradores en las 4 esquinas (2 ejes) + líneas de arista (1 eje),
 *    visibles solo al seleccionar. Al soltar persiste la geometría en group_layout.
 *  - 4 franjas de perímetro clicables: seleccionan el contenedor (la selección
 *    activa el NodeResizer) sin robar el clic al interior.
 *
 * Debe renderizarse como hijo directo del nodo (las franjas se posicionan absolutas
 * respecto al wrapper .react-flow__node, que es position:absolute).
 */
export function GroupResizeControls({
  id,
  selected,
  minWidth,
  minHeight,
}: {
  id: string
  selected: boolean
  minWidth: number
  minHeight: number
}) {
  const setGroupGeometry = useStore((s) => s.setGroupGeometry)
  const rim: CSSProperties = {
    position: 'absolute',
    pointerEvents: 'auto',
    background: 'transparent',
    cursor: 'pointer',
  }

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={minWidth}
        minHeight={minHeight}
        onResizeEnd={(_e, { x, y, width, height }) => setGroupGeometry(id, { x, y, width, height })}
        lineStyle={{ borderColor: 'var(--color-accent)', borderWidth: 2 }}
        handleStyle={{
          width: 10,
          height: 10,
          borderRadius: 2,
          background: 'var(--color-surface)',
          border: '2px solid var(--color-accent)',
        }}
      />
      <div style={{ ...rim, top: 0, left: 0, right: 0, height: RIM }} />
      <div style={{ ...rim, bottom: 0, left: 0, right: 0, height: RIM }} />
      <div style={{ ...rim, top: 0, bottom: 0, left: 0, width: RIM }} />
      <div style={{ ...rim, top: 0, bottom: 0, right: 0, width: RIM }} />
    </>
  )
}
