import type { RefObject } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { useNodeAttrEditor } from '../../hooks/useNodeAttrEditor'

// Campos de edición inline (nombre + filas de atributos con añadir/eliminar) en
// disposición centrada. Lo usan los nodos de caja (C4 / arquitectura legacy); la
// tabla ERD y el icono de arquitectura traen su propia disposición. Recibe el objeto
// del hook useNodeAttrEditor y el ref de filas (propiedad del nodo) para no duplicar
// lógica.
interface InlineAttrFieldsProps {
  ed: ReturnType<typeof useNodeAttrEditor>
  rowRefs: RefObject<(HTMLInputElement | null)[]>
}

export function InlineAttrFields({ ed, rowRefs }: InlineAttrFieldsProps) {
  return (
    <>
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
        className="w-full text-center text-sm font-semibold text-[var(--color-ink)] bg-[var(--color-surface)] border-2 border-[var(--color-ink)] rounded-[var(--radius)] outline-none px-1 py-0.5 box-border"
      />
      <div className="flex flex-col gap-1 mt-1.5">
        {ed.attrs.map((attr, i) => (
          <div key={i} className="flex items-center gap-1">
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
              placeholder="atributo"
              className="flex-1 min-w-0 text-xs text-[var(--color-ink)] bg-[var(--color-surface)] border border-[var(--color-ink)]/40 rounded outline-none px-1 py-0.5 focus:border-[var(--color-accent)]"
            />
            <button
              onClick={() => ed.deleteRow(i)}
              className="shrink-0 text-red-500 hover:text-red-600"
              title="Eliminar atributo"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <button
          onClick={ed.addRow}
          className="flex items-center justify-center gap-1 text-[11px] font-semibold text-[var(--color-ink)]/70 hover:text-[var(--color-accent)]"
        >
          <Plus size={12} /> Añadir
        </button>
      </div>
    </>
  )
}
