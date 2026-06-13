import { forwardRef } from 'react'
import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

const variantStyles: Record<Variant, string> = {
  primary: 'bg-[var(--color-accent)] text-white',
  secondary: 'bg-[var(--color-surface)] text-[var(--color-ink)]',
  danger: 'bg-[var(--color-danger)] text-white',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', className = '', disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled}
      className={`
        px-4 py-2 font-semibold border-[3px] border-[var(--color-ink)] rounded-[var(--radius)]
        shadow-[var(--shadow-brutal)] transition-all duration-75
        hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[var(--shadow-brutal-lg)]
        active:translate-x-[2px] active:translate-y-[2px] active:shadow-none
        disabled:opacity-50 disabled:pointer-events-none
        ${variantStyles[variant]} ${className}
      `}
      {...props}
    >
      {children}
    </button>
  )
)
Button.displayName = 'Button'
