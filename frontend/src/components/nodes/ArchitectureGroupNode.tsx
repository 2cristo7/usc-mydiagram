import { type NodeProps, type Node } from '@xyflow/react'

type GroupData = { label: string }
type GroupNodeType = Node<GroupData, 'architectureGroup'>

export function ArchitectureGroupNode({ data }: NodeProps<GroupNodeType>) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        border: '2px dashed var(--color-ink)',
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
  )
}
