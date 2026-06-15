import { useEffect, useRef } from 'react'
import { Minus, CornerDownRight, Spline, Trash2 } from 'lucide-react'
import { useStore } from '../../store'
import type { EdgeVisualData } from '../../types'

export interface EdgeContextMenuProps {
  edgeId: string
  position: { x: number; y: number }
  onClose: () => void
}

export function EdgeContextMenu({ edgeId, position, onClose }: EdgeContextMenuProps) {
  const edge = useStore((s) => s.edges.find((e) => e.id === edgeId))
  const updateEdge = useStore((s) => s.updateEdge)
  const removeEdge = useStore((s) => s.removeEdge)

  const menuRef = useRef<HTMLDivElement>(null)

  const edgeData = ((edge as Record<string, unknown>)?.data ?? {}) as EdgeVisualData
  const shape = edgeData.shape ?? 'curved'
  const strokeStyle = edgeData.strokeStyle ?? 'normal'
  const arrowStart: boolean = edgeData.sourceArrow ?? false
  const arrowEnd: boolean = edgeData.targetArrow ?? true

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  if (!edge) return null

  function updateData(patch: Partial<EdgeVisualData>) {
    updateEdge(edgeId, { data: { ...edgeData, ...patch } } as never)
  }

  function handleDelete() {
    removeEdge(edgeId)
    onClose()
  }

  const radioBase =
    'flex items-center gap-1 px-2 py-1 text-xs border-2 border-[var(--color-ink)] rounded cursor-pointer select-none transition-colors'
  const radioActive = 'bg-[var(--color-ink)] text-[var(--color-surface)]'
  const radioInactive = 'bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-ink)]/10'

  const toggleBase =
    'px-2 py-1 text-xs border-2 border-[var(--color-ink)] rounded cursor-pointer select-none transition-colors'

  return (
    <div
      ref={menuRef}
      style={{ position: 'fixed', left: position.x, top: position.y, zIndex: 9999 }}
      className="min-w-[180px] bg-[var(--color-surface)] border-2 border-[var(--color-ink)] shadow-[3px_3px_0_var(--color-ink)] rounded-lg p-2 flex flex-col gap-3"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Etiqueta — única vía para añadir/editar el texto desde que el doble
          clic sobre la línea pasó a crear esquinas. */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink)]/60 mb-1 px-1">
          Etiqueta
        </p>
        <input
          type="text"
          value={edgeData.label ?? ''}
          placeholder="Texto de la arista"
          onChange={(e) => updateData({ label: e.target.value })}
          className="w-full px-2 py-1 text-xs bg-[var(--color-surface)] border-2 border-[var(--color-ink)] rounded outline-none focus:bg-[var(--color-ink)]/5"
        />
      </div>

      {/* Shape */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink)]/60 mb-1 px-1">
          Forma
        </p>
        <div className="flex gap-1">
          {([
            { value: 'straight', Icon: Minus, label: 'Recta' },
            { value: 'elbow', Icon: CornerDownRight, label: 'Codo' },
            { value: 'curved', Icon: Spline, label: 'Curva' },
          ] as const).map(({ value, Icon, label }) => (
            <button
              key={value}
              title={label}
              onClick={() => updateData({ shape: value })}
              className={`${radioBase} ${shape === value ? radioActive : radioInactive}`}
            >
              <Icon size={13} />
            </button>
          ))}
        </div>
      </div>

      {/* Stroke */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink)]/60 mb-1 px-1">
          Trazo
        </p>
        <div className="flex gap-1">
          {([
            { value: 'normal', label: '—' },
            { value: 'dashed', label: '- -' },
            { value: 'dotted', label: '···' },
          ] as const).map(({ value, label }) => (
            <button
              key={value}
              onClick={() => updateData({ strokeStyle: value })}
              className={`${radioBase} ${strokeStyle === value ? radioActive : radioInactive}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Arrow */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink)]/60 mb-1 px-1">
          Flecha
        </p>
        <div className="flex gap-1">
          <button
            onClick={() => updateData({ sourceArrow: !arrowStart })}
            className={`${toggleBase} ${arrowStart ? radioActive : radioInactive}`}
          >
            ← Inicio
          </button>
          <button
            onClick={() => updateData({ targetArrow: !arrowEnd })}
            className={`${toggleBase} ${arrowEnd ? radioActive : radioInactive}`}
          >
            Fin →
          </button>
        </div>
      </div>

      <hr className="border-[var(--color-ink)]/20" />

      {/* Delete */}
      <button
        onClick={handleDelete}
        className="flex items-center gap-2 px-2 py-1.5 text-xs font-semibold text-red-600 border-2 border-red-500 rounded hover:bg-red-50 transition-colors"
      >
        <Trash2 size={13} />
        Eliminar arista
      </button>
    </div>
  )
}
