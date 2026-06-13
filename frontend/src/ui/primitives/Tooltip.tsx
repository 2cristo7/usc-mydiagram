import { useState } from 'react'
import type { ReactNode } from 'react'

interface TooltipProps {
  content: string
  children: ReactNode
}

export function Tooltip({ content, children }: TooltipProps) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative inline-block" onMouseEnter={() => setVisible(true)} onMouseLeave={() => setVisible(false)}>
      {children}
      {visible && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs whitespace-nowrap border-[2px] border-[var(--color-ink)] bg-[var(--color-surface)] text-[var(--color-ink)] rounded-[var(--radius)]">
          {content}
        </div>
      )}
    </div>
  )
}
