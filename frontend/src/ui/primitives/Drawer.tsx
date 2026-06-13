import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

interface DrawerProps {
  open: boolean
  onClose: () => void
  children: ReactNode
}

export function Drawer({ open, onClose, children }: DrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/30" />
      <div
        ref={drawerRef}
        className="relative h-full w-80 bg-[var(--color-surface)] border-r-[3px] border-[var(--color-ink)] shadow-[var(--shadow-brutal-lg)] animate-[slideIn_150ms_ease-out]"
      >
        {children}
      </div>
    </div>
  )
}
