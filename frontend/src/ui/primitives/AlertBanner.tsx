import { X } from 'lucide-react'

type AlertVariant = 'error' | 'warning' | 'info'

interface AlertBannerProps {
  message: string
  onDismiss: () => void
  variant?: AlertVariant
  // Acción opcional (botón) a la izquierda del cierre, p. ej. "Abrir configuración".
  action?: { label: string; onClick: () => void }
}

const variantStyles: Record<AlertVariant, { bg: string; border: string; text: string }> = {
  error: {
    bg: 'bg-[var(--color-danger)]',
    border: 'border-[var(--color-ink)]',
    text: 'text-white',
  },
  warning: {
    bg: 'bg-[var(--color-warn)]',
    border: 'border-[var(--color-ink)]',
    text: 'text-[var(--color-ink)]',
  },
  info: {
    bg: 'bg-[var(--color-accent-2)]',
    border: 'border-[var(--color-ink)]',
    text: 'text-white',
  },
}

export function AlertBanner({ message, onDismiss, variant = 'error', action }: AlertBannerProps) {
  const styles = variantStyles[variant]
  return (
    <div
      role="alert"
      className={`flex items-start gap-3 px-4 py-3 border-b-[3px] ${styles.border} ${styles.bg} ${styles.text}`}
    >
      <p className="flex-1 text-sm font-semibold leading-snug">{message}</p>
      {action && (
        <button
          onClick={action.onClick}
          className={`
            shrink-0 self-center px-3 py-1 text-xs font-bold
            border-[2px] ${styles.border} rounded-[var(--radius)] bg-[var(--color-surface)] text-[var(--color-ink)]
            transition-all duration-75
            hover:translate-x-[-1px] hover:translate-y-[-1px]
            active:translate-x-[1px] active:translate-y-[1px]
          `}
        >
          {action.label}
        </button>
      )}
      <button
        onClick={onDismiss}
        aria-label="Cerrar alerta"
        className={`
          shrink-0 flex h-6 w-6 items-center justify-center
          border-[2px] ${styles.border} rounded-[var(--radius)]
          transition-all duration-75
          hover:translate-x-[-1px] hover:translate-y-[-1px]
          active:translate-x-[1px] active:translate-y-[1px]
        `}
      >
        <X size={12} />
      </button>
    </div>
  )
}
