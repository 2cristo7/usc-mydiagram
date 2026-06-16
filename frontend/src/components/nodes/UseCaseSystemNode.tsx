import { type NodeProps, type Node } from '@xyflow/react'

type SystemData = { label: string }
type SystemNodeType = Node<SystemData, 'useCaseSystem'>

// Nodo contenedor «subsystem» para diagramas de casos de uso UML.
// Caja rectangular con borde sólido y etiqueta en la esquina superior izquierda.
// Actúa como grupo visual (sin handles propios); los casos de uso se colocan dentro.
export function UseCaseSystemNode({ data }: NodeProps<SystemNodeType>) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        border: '2px solid var(--color-ink)',
        borderRadius: 'var(--radius)',
        background: 'rgba(0,0,0,0.02)',
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
  )
}
