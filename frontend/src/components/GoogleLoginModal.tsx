import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { signInWithGoogle } from '../hooks/useAuth'
import { Spinner } from '../ui/primitives'

interface GoogleLoginModalProps {
  open: boolean
  onClose: () => void
}

// Logo oficial de Google (la "G" multicolor) como SVG inline.
function GoogleLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001.002-.001.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  )
}

export function GoogleLoginModal({ open, onClose }: GoogleLoginModalProps) {
  // El login redirige toda la página vía OAuth; entre el clic y la redirección
  // puede haber un instante de espera. Mostramos carga y bloqueamos el botón.
  const [loading, setLoading] = useState(false)

  // Cerrar descarta cualquier estado de carga pendiente y avisa al padre.
  function close() {
    setLoading(false)
    onClose()
  }

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  async function handleLogin() {
    setLoading(true)
    try {
      await signInWithGoogle()
    } catch {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      onMouseDown={close}
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Iniciar sesión"
        onMouseDown={(e) => e.stopPropagation()}
        className="relative w-[340px] max-w-[90vw] bg-[var(--color-surface)] border-[3px] border-[var(--color-ink)] rounded-[var(--radius)] shadow-[var(--shadow-brutal-lg)] p-6 flex flex-col items-center gap-5"
      >
        <button
          onClick={close}
          aria-label="Cerrar"
          className="absolute top-3 right-3 flex h-7 w-7 items-center justify-center border-[2px] border-[var(--color-ink)] rounded-[var(--radius)] bg-[var(--color-surface)] text-[var(--color-ink)] transition-all duration-75 hover:translate-x-[-1px] hover:translate-y-[-1px] active:translate-x-[1px] active:translate-y-[1px]"
        >
          <X size={14} />
        </button>

        <div className="flex h-16 w-16 items-center justify-center border-[3px] border-[var(--color-ink)] rounded-full bg-[var(--color-surface)] shadow-[var(--shadow-brutal)]">
          <GoogleLogo size={32} />
        </div>

        <div className="text-center">
          <h2 className="text-lg font-bold text-[var(--color-ink)]">Bienvenido a MydIAgram</h2>
          <p className="text-sm text-[var(--color-ink)] opacity-70">
            Inicia sesión para guardar tus diagramas
          </p>
        </div>

        <button
          onClick={handleLogin}
          disabled={loading}
          className="flex w-full items-center justify-center gap-3 px-4 py-2.5 font-semibold border-[3px] border-[var(--color-ink)] rounded-[var(--radius)] bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[var(--shadow-brutal)] transition-all duration-75 hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[var(--shadow-brutal-lg)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-60 disabled:pointer-events-none"
        >
          {loading ? <Spinner size={20} label="Conectando" /> : <GoogleLogo size={20} />}
          {loading ? 'Conectando…' : 'Continuar con Google'}
        </button>
      </div>
    </div>
  )
}
