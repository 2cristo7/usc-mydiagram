import { useRef } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { NodeType } from '../../types'
import { useNodeAttrEditor } from '../../hooks/useNodeAttrEditor'
import { InlineAttrFields } from './InlineAttrFields'

type C4Data = { label: string; nodeType: NodeType; attributes: string[] }
type C4NodeType = Node<C4Data, 'c4'>

const C4_COLORS: Partial<Record<NodeType, string>> = {
  person: 'var(--color-accent-2)',
  system: 'var(--color-accent-3)',
  container: 'var(--color-warn)',
  component: '#a855f7',
}

function extractTech(attributes: string[]): string | null {
  const techAttr = attributes.find((a) => /^tech\s*:/i.test(a))
  if (!techAttr) return null
  const m = techAttr.match(/^tech\s*:\s*(.+)/i)
  return m ? m[1].trim() : null
}

export function C4Node({ id, data }: NodeProps<C4NodeType>) {
  const { label, nodeType, attributes = [] } = data
  const color = C4_COLORS[nodeType] ?? 'var(--color-accent)'
  const tech = extractTech(attributes)
  const containerRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<(HTMLInputElement | null)[]>([])
  const ed = useNodeAttrEditor(id, label, attributes, { containerRef, rowRefs })

  return (
    <div
      ref={containerRef}
      className={`bg-[var(--color-surface)] border-[3px] border-[var(--color-ink)] shadow-[var(--shadow-brutal)] rounded-[var(--radius)] min-w-[120px] ${
        ed.isEditing ? 'nodrag nowheel' : ''
      }`}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (!ed.isEditing) ed.start()
      }}
    >
      <div
        className="px-3 py-1 border-b-[3px] border-[var(--color-ink)] text-xs font-semibold text-white text-center"
        style={{ backgroundColor: color }}
      >
        {nodeType}
      </div>
      <div className="px-3 py-2 text-center">
        {ed.isEditing ? (
          <InlineAttrFields ed={ed} rowRefs={rowRefs} />
        ) : (
          <>
            <div className="font-semibold text-sm text-[var(--color-ink)]">{label}</div>
            {tech && <div className="text-xs text-[var(--color-ink)]/60 mt-0.5">{tech}</div>}
          </>
        )}
      </div>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
