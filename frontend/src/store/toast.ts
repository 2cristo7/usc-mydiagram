import { create } from 'zustand'

// Sistema de notificaciones efímeras (toasts). Reemplaza el feedback disperso por
// console.error / window.alert: cualquier capa (handlers de socket, cliente REST,
// componentes) puede avisar al usuario de un fallo o un éxito de forma uniforme.
// El helper `toast` lee el store con getState(), así que es invocable FUERA de
// React (en lib/api.ts, hooks/useWebSocket.ts, etc.), no solo desde componentes.

export type ToastVariant = 'error' | 'success' | 'info' | 'warning'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: string
  variant: ToastVariant
  message: string
  // Acción opcional (p. ej. "Reintentar"): se muestra como botón en el toast.
  action?: ToastAction
}

export interface ToastOptions {
  // ms hasta autodescartar. 0 = persistente (el usuario lo cierra a mano). Por
  // defecto los errores duran más que los éxitos (ver DEFAULT_DURATIONS).
  duration?: number
  action?: ToastAction
}

interface ToastStore {
  toasts: Toast[]
  push: (variant: ToastVariant, message: string, options?: ToastOptions) => string
  dismiss: (id: string) => void
  clear: () => void
}

// Duración por defecto según severidad: un error necesita más tiempo de lectura
// (y suele llevar acción) que una confirmación de éxito.
const DEFAULT_DURATIONS: Record<ToastVariant, number> = {
  error: 7000,
  warning: 6000,
  info: 5000,
  success: 4000,
}

// Evita duplicar el mismo toast si se dispara en ráfaga (p. ej. varios fallos de
// autoguardado seguidos): si ya hay uno idéntico vivo, no se apila otro.
function isDuplicate(toasts: Toast[], variant: ToastVariant, message: string): boolean {
  return toasts.some((t) => t.variant === variant && t.message === message)
}

const _timers = new Map<string, ReturnType<typeof setTimeout>>()

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (variant, message, options) => {
    if (isDuplicate(get().toasts, variant, message)) return ''
    const id = crypto.randomUUID()
    set((s) => ({ toasts: [...s.toasts, { id, variant, message, action: options?.action }] }))
    const duration = options?.duration ?? DEFAULT_DURATIONS[variant]
    if (duration > 0) {
      _timers.set(
        id,
        setTimeout(() => get().dismiss(id), duration),
      )
    }
    return id
  },
  dismiss: (id) => {
    const timer = _timers.get(id)
    if (timer) {
      clearTimeout(timer)
      _timers.delete(id)
    }
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
  clear: () => {
    for (const timer of _timers.values()) clearTimeout(timer)
    _timers.clear()
    set({ toasts: [] })
  },
}))

// Helper estable e invocable desde cualquier capa (no solo componentes React).
export const toast = {
  error: (message: string, options?: ToastOptions) =>
    useToastStore.getState().push('error', message, options),
  success: (message: string, options?: ToastOptions) =>
    useToastStore.getState().push('success', message, options),
  info: (message: string, options?: ToastOptions) =>
    useToastStore.getState().push('info', message, options),
  warning: (message: string, options?: ToastOptions) =>
    useToastStore.getState().push('warning', message, options),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
}
