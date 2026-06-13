import { forwardRef } from 'react'
import type { HTMLAttributes } from 'react'

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className = '', children, ...props }, ref) => (
    <div
      ref={ref}
      className={`
        p-4 border-[3px] border-[var(--color-ink)] rounded-[var(--radius)]
        bg-[var(--color-surface)] shadow-[var(--shadow-brutal)]
        ${className}
      `}
      {...props}
    >
      {children}
    </div>
  )
)
Card.displayName = 'Card'
