import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

interface MenuItem {
  label: string
  icon?: ReactNode
  onClick: () => void
  disabled?: boolean
}

interface MenuProps {
  trigger: ReactNode
  items: MenuItem[]
}

export function Menu({ trigger, items }: MenuProps) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={menuRef} className="relative inline-block">
      <div onClick={() => setOpen(!open)}>{trigger}</div>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] border-[3px] border-[var(--color-ink)] rounded-[var(--radius)] bg-[var(--color-surface)] shadow-[var(--shadow-brutal)]">
          {items.map((item, i) => (
            <button
              key={i}
              disabled={item.disabled}
              onClick={() => { item.onClick(); setOpen(false) }}
              className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-[var(--color-accent)]/10 disabled:opacity-50 disabled:pointer-events-none text-[var(--color-ink)]"
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
