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
  const isDanger = tone === 'danger'
  const titleColor = isDanger ? 'text-[var(--color-danger)]' : 'text-[var(--color-ink)]/70'
  const iconColor = isDanger ? 'text-[var(--color-danger)]' : 'text-[var(--color-ink)]/30'
  // En tono danger el CTA se remata con el borde en color de peligro y hover rojo
  // sólido (lenguaje neobrutalista), reforzando que es la acción de un error. En
  // tono default conserva el borde de tinta y el hover de acento de siempre.
  const actionClasses = isDanger
    ? 'border-[var(--color-danger)] bg-[var(--color-surface)] text-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-white'
    : 'border-[var(--color-ink)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-accent)]/10'
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
          className={`mt-1 border-[3px] px-4 py-2 text-sm font-semibold shadow-[var(--shadow-brutal)] transition-all duration-75 hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[var(--shadow-brutal-lg)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none ${actionClasses}`}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
