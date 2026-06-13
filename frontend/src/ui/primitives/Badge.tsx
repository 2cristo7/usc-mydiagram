import type { HTMLAttributes } from 'react'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  color?: string
}

export function Badge({ color = 'var(--color-accent)', className = '', children, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold border-[2px] border-[var(--color-ink)] rounded-[var(--radius)] ${className}`}
      style={{ backgroundColor: color }}
      {...props}
    >
      {children}
    </span>
  )
}
