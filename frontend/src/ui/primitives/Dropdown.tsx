import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'

export interface DropdownOption {
  value: string
  label: string
}

interface DropdownProps {
  value: string
  options: DropdownOption[]
  onChange: (value: string) => void
  placeholder?: string
  /** Texto monoespaciado para nombres de modelo. */
  mono?: boolean
  ariaLabel?: string
}

// Dropdown brutalista: botón con borde de 3px + sombra, y un popup con la misma
// estética. Reemplaza al <select> nativo (cuya lista desplegable no es estilable)
// para que las opciones encajen con el resto de la UI.
export function Dropdown({ value, options, onChange, placeholder, mono, ariaLabel }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const [openUp, setOpenUp] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const selected = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  // Abrir hacia arriba si no hay sitio debajo (el modal tiene scroll propio).
  useLayoutEffect(() => {
    if (!open || !rootRef.current) return
    const rect = rootRef.current.getBoundingClientRect()
    setOpenUp(window.innerHeight - rect.bottom < 240 && rect.top > 240)
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`
          flex w-full items-center justify-between gap-2 px-3 py-2 text-sm font-semibold
          border-[3px] border-[var(--color-ink)] rounded-[var(--radius)]
          bg-[var(--color-surface)] text-[var(--color-ink)] text-left
          transition-all duration-75 outline-none
          ${open ? 'shadow-[var(--shadow-brutal)]' : 'hover:shadow-[var(--shadow-brutal)]'}
        `}
      >
        <span className={`truncate ${mono ? 'font-mono' : ''} ${selected ? '' : 'opacity-50'}`}>
          {selected ? selected.label : placeholder ?? 'Selecciona…'}
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 transition-transform duration-100 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          className={`
            absolute left-0 z-50 w-full max-h-[240px] overflow-y-auto scrollbar-brutal
            border-[3px] border-[var(--color-ink)] rounded-[var(--radius)]
            bg-[var(--color-surface)] shadow-[var(--shadow-brutal)]
            ${openUp ? 'bottom-full mb-1' : 'top-full mt-1'}
          `}
        >
          {options.map((opt) => {
            const active = opt.value === value
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => { onChange(opt.value); setOpen(false) }}
                  className={`
                    flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm
                    border-b-[2px] border-[var(--color-ink)] last:border-b-0
                    transition-colors duration-75
                    ${mono ? 'font-mono' : 'font-semibold'}
                    ${active
                      ? 'bg-[var(--color-ink)] text-[var(--color-surface)]'
                      : 'bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-accent)] hover:text-[var(--color-surface)]'
                    }
                  `}
                >
                  <span className="truncate">{opt.label}</span>
                  {active && <Check size={14} className="shrink-0" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
