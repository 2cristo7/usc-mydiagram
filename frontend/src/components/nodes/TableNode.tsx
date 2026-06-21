import { useRef } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { Plus, Trash2 } from 'lucide-react'
import { useNodeAttrEditor } from '../../hooks/useNodeAttrEditor'

type TableData = { label: string; attributes: string[] }
type TableNodeType = Node<TableData, 'table'>

export function TableNode({ id, data }: NodeProps<TableNodeType>) {
  const { label, attributes } = data
  const containerRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<(HTMLInputElement | null)[]>([])
  const ed = useNodeAttrEditor(id, label, attributes, { containerRef, rowRefs })

  return (
    <div
      ref={containerRef}
      className={`bg-[var(--color-surface)] border-[3px] border-[var(--color-ink)] rounded-[var(--radius)] shadow-[var(--shadow-brutal)] min-w-[160px] ${
        ed.isEditing ? 'nodrag nowheel' : ''
      }`}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (!ed.isEditing) ed.start()
      }}
    >
      <div className="bg-[var(--color-accent)] px-3 py-1.5 border-b-[3px] border-[var(--color-ink)]">
        {ed.isEditing ? (
          <input
            autoFocus
            value={ed.name}
            onChange={(e) => ed.setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (rowRefs.current[0]) rowRefs.current[0].focus()
                else ed.addRow()
              }
            }}
            className="font-bold text-sm text-white bg-transparent border-b border-white/60 outline-none w-full"
          />
        ) : (
          <span className="font-bold text-sm text-white">{label}</span>
        )}
      </div>

      <div className="px-3 py-1.5">
        {ed.isEditing ? (
          <>
            {ed.attrs.map((attr, i) => (
              <div key={i} className="flex items-center gap-1 py-0.5">
                <input
                  ref={(el) => {
                    rowRefs.current[i] = el
                  }}
                  value={attr}
                  onChange={(e) => ed.updateRow(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      ed.addRow()
                    }
                  }}
                  placeholder="columna"
                  className="flex-1 min-w-0 text-xs font-mono text-[var(--color-ink)] bg-transparent border border-[var(--color-ink)]/40 rounded px-1 py-0.5 outline-none focus:border-[var(--color-accent)]"
                />
                <button
                  onClick={() => ed.deleteRow(i)}
                  className="shrink-0 text-red-500 hover:text-red-600"
                  title="Eliminar columna"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <button
              onClick={ed.addRow}
              className="flex items-center gap-1 mt-1 text-[11px] font-semibold text-[var(--color-ink)]/70 hover:text-[var(--color-accent)]"
            >
              <Plus size={12} /> Añadir columna
            </button>
          </>
        ) : (
          <>
            {attributes.length === 0 && (
              <p className="py-0.5 text-xs italic text-[var(--color-ink)]/40">Sin columnas</p>
            )}
            {attributes.map((attr, i) => {
              const isPK = attr.includes('PK')
              const isFK = attr.includes('FK')
              return (
                <div
                  key={i}
                  className="flex items-center gap-1 py-0.5 text-xs font-mono text-[var(--color-ink)]"
                >
                  {isPK && <span title="Primary Key">🔑</span>}
                  {isFK && !isPK && <span title="Foreign Key">🔗</span>}
                  <span>{attr}</span>
                </div>
              )
            })}
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
