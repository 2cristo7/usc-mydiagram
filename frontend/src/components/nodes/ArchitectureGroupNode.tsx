import { type NodeProps, type Node } from '@xyflow/react'
import { GroupResizeControls } from './GroupResizeControls'

type GroupData = { label: string }
type GroupNodeType = Node<GroupData, 'architectureGroup'>

// Tamaño mínimo al redimensionar: que el contenedor no pueda encogerse por debajo
// de la cabecera + un icono con sus márgenes.
const MIN_W = 140
const MIN_H = 120

export function ArchitectureGroupNode({ id, data, selected }: NodeProps<GroupNodeType>) {
  return (
    <>
      <GroupResizeControls id={id} selected={selected} minWidth={MIN_W} minHeight={MIN_H} />

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
