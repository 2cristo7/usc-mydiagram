import { NodeResizer, type NodeProps, type Node } from '@xyflow/react'
import type { CSSProperties } from 'react'
import { useStore } from '../../store/index'

type GroupData = { label: string }
type GroupNodeType = Node<GroupData, 'architectureGroup'>

// Grosor (px) de la franja del perímetro que captura clics para seleccionar el
// contenedor. El interior queda transparente a eventos (pointerEvents:none) para
// no robarle el clic a los iconos hijos ni al paneo/selección sobre el canvas.
const RIM = 14
// Tamaño mínimo al redimensionar: que el contenedor no pueda encogerse por debajo
// de la cabecera + un icono con sus márgenes.
const MIN_W = 140
const MIN_H = 120

export function ArchitectureGroupNode({ id, data, selected }: NodeProps<GroupNodeType>) {
  const setGroupGeometry = useStore((s) => s.setGroupGeometry)
  const rim: CSSProperties = {
    position: 'absolute',
    pointerEvents: 'auto',
    background: 'transparent',
  }

  return (
    <>
      {/* Tiradores de redimensionado: esquinas (2 ejes) + líneas de arista (1 eje).
          Solo visibles cuando el contenedor está seleccionado. Al soltar, la nueva
          geometría se persiste (group_layout) → versión manual_edit + guardado BD. */}
      <NodeResizer
        isVisible={selected}
        minWidth={MIN_W}
        minHeight={MIN_H}
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

      <div
        style={{
          width: '100%',
          height: '100%',
          border: '2px dashed var(--color-ink)',
          borderRadius: 'var(--radius)',
          background: 'rgba(0,0,0,0.02)',
          // Resalte sutil cuando está seleccionado (además de los tiradores).
          boxShadow: selected ? '0 0 0 2px color-mix(in srgb, var(--color-accent) 40%, transparent)' : 'none',
          position: 'relative',
          // El fondo NO captura eventos: los iconos hijos y el canvas siguen siendo
          // clicables a través del contenedor.
          pointerEvents: 'none',
        }}
      >
        {/* Franjas del perímetro clicables: arrastrar/clicar aquí selecciona el
            contenedor (la selección activa el NodeResizer de arriba). */}
        <div style={{ ...rim, top: 0, left: 0, right: 0, height: RIM, cursor: 'pointer' }} />
        <div style={{ ...rim, bottom: 0, left: 0, right: 0, height: RIM, cursor: 'pointer' }} />
        <div style={{ ...rim, top: 0, bottom: 0, left: 0, width: RIM, cursor: 'pointer' }} />
        <div style={{ ...rim, top: 0, bottom: 0, right: 0, width: RIM, cursor: 'pointer' }} />

        <div
          style={{
            position: 'absolute',
            top: 6,
            left: 10,
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--color-ink)',
            opacity: 0.6,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          {data.label}
        </div>
      </div>
    </>
  )
}
