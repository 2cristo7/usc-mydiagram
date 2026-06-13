import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode
  tooltip?: string
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, tooltip, className = '', disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled}
      title={tooltip}
      className={`
        w-10 h-10 flex items-center justify-center
        border-[3px] border-[var(--color-ink)] rounded-[var(--radius)]
        bg-[var(--color-surface)] text-[var(--color-ink)]
        shadow-[var(--shadow-brutal)] transition-all duration-75
        hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[var(--shadow-brutal-lg)]
        active:translate-x-[2px] active:translate-y-[2px] active:shadow-none
        disabled:opacity-50 disabled:pointer-events-none
        ${className}
      `}
      {...props}
    >
      {icon}
    </button>
  )
)
IconButton.displayName = 'IconButton'
