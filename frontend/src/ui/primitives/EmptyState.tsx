import type { ReactNode } from 'react'

interface EmptyStateProps {
  /** Icono ya dimensionado (p. ej. <Inbox size={40} />). */
  icon?: ReactNode
  title: string
  description?: string
  /** CTA opcional al pie. */
  action?: { label: string; onClick: () => void }
  tone?: 'default' | 'danger'
  className?: string
}

// Estado vacío reutilizable: icono atenuado + título + descripción opcional + CTA
// opcional. Centrado, pensado para ocupar el hueco de una lista/canvas sin datos.
export function EmptyState({
  icon,
  title,
  description,
  action,
  tone = 'default',
  className = '',
}: EmptyStateProps) {
  const titleColor = tone === 'danger' ? 'text-[var(--color-danger)]' : 'text-[var(--color-ink)]/70'
  const iconColor = tone === 'danger' ? 'text-[var(--color-danger)]' : 'text-[var(--color-ink)]/30'
  return (
    <div className={`flex flex-col items-center justify-center gap-3 px-6 text-center ${className}`}>
      {icon && <div className={iconColor}>{icon}</div>}
      <p className={`text-sm font-semibold ${titleColor}`}>{title}</p>
      {description && (
        <p className="max-w-[34ch] text-xs text-[var(--color-ink)]/50">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-1 border-[3px] border-[var(--color-ink)] bg-[var(--color-surface)] px-4 py-2 text-sm font-semibold text-[var(--color-ink)] shadow-[var(--shadow-brutal)] transition-all duration-75 hover:translate-x-[-1px] hover:translate-y-[-1px] hover:bg-[var(--color-accent)]/10 hover:shadow-[var(--shadow-brutal-lg)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
