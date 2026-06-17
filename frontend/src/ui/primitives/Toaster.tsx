import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useToastStore, type ToastVariant } from '../../store/toast'

// Render de la cola de toasts (apilados abajo a la derecha). Lenguaje visual
// neobrutalista coherente con el resto de primitives: borde grueso de tinta +
// sombra dura. Cada toast se autodescarta (timer en el store) o se cierra a mano.

const VARIANT_STYLES: Record<ToastVariant, { bg: string; text: string; icon: typeof Info }> = {
  error: { bg: 'bg-[var(--color-danger)]', text: 'text-white', icon: AlertTriangle },
  warning: { bg: 'bg-[var(--color-warn)]', text: 'text-[var(--color-ink)]', icon: AlertTriangle },
  info: { bg: 'bg-[var(--color-accent-2)]', text: 'text-white', icon: Info },
  success: { bg: 'bg-[var(--color-accent-3)]', text: 'text-white', icon: CheckCircle2 },
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  if (toasts.length === 0) return null

  return (
    <div
      className="fixed bottom-4 right-4 z-[100] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((t) => {
        const styles = VARIANT_STYLES[t.variant]
        const Icon = styles.icon
        return (
          <div
            key={t.id}
            role={t.variant === 'error' ? 'alert' : 'status'}
            className={`flex items-start gap-3 border-[3px] border-[var(--color-ink)] p-3 shadow-[var(--shadow-brutal)] ${styles.bg} ${styles.text}`}
          >
            <Icon size={18} className="mt-[1px] shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-snug break-words">{t.message}</p>
              {t.action && (
                <button
                  onClick={() => {
                    t.action!.onClick()
                    dismiss(t.id)
                  }}
                  className="mt-2 border-[2px] border-current px-2 py-1 text-xs font-bold uppercase tracking-wide transition-all hover:translate-x-[-1px] hover:translate-y-[-1px] active:translate-x-[1px] active:translate-y-[1px]"
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Cerrar notificación"
              className="shrink-0 flex h-6 w-6 items-center justify-center border-[2px] border-current transition-all hover:translate-x-[-1px] hover:translate-y-[-1px] active:translate-x-[1px] active:translate-y-[1px]"
            >
              <X size={12} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
