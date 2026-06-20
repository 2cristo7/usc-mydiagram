import { type NodeProps, type Node } from '@xyflow/react'
import { GroupResizeControls } from './GroupResizeControls'

type SystemData = { label: string }
type SystemNodeType = Node<SystemData, 'useCaseSystem'>

// Tamaño mínimo al redimensionar el subsistema.
const MIN_W = 160
const MIN_H = 140

// Nodo contenedor «subsystem» para diagramas de casos de uso UML.
// Caja rectangular con borde sólido y etiqueta en la esquina superior izquierda.
// Actúa como grupo visual; los casos de uso se colocan dentro. Clicable por el
// perímetro y redimensionable (GroupResizeControls → group_layout).
export function UseCaseSystemNode({ id, data, selected }: NodeProps<SystemNodeType>) {
  return (
    <>
      <GroupResizeControls id={id} selected={selected} minWidth={MIN_W} minHeight={MIN_H} />

      <div
        style={{
          width: '100%',
          height: '100%',
          border: '2px solid var(--color-ink)',
          borderRadius: 'var(--radius)',
          background: 'rgba(0,0,0,0.02)',
          boxShadow: selected ? '0 0 0 2px color-mix(in srgb, var(--color-accent) 40%, transparent)' : 'none',
          position: 'relative',
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
            opacity: 0.7,
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
