import { useEffect, useRef, useState } from 'react'
import { LogOut, User } from 'lucide-react'
import { useAuthStore } from '../store/auth'
import { signOut } from '../hooks/useAuth'
import { useStore } from '../store/index'
import { useHistoryStore } from '../store/history'
import { GoogleLoginModal } from './GoogleLoginModal'

// Botón de perfil para el pie de la barra lateral. Invitado: icono genérico que
// abre el modal de login con Google. Sesión iniciada: avatar (o icono) que cierra
// sesión, avisando antes si hay contenido sin guardar.
export function AuthButton() {
  const user = useAuthStore((s) => s.user)
  const [loginOpen, setLoginOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Cierra el menú de perfil al clicar fuera.
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  // Marco neobrutalista compartido por el icono/avatar.
  const frame =
    'flex h-10 w-10 items-center justify-center overflow-hidden border-[3px] border-[var(--color-ink)] rounded-full bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[var(--shadow-brutal)] transition-all duration-75 hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[var(--shadow-brutal-lg)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none'

  if (!user) {
    return (
      <>
        <button
          onClick={() => setLoginOpen(true)}
          className={frame}
          title="Iniciar sesión"
          aria-label="Iniciar sesión con Google"
        >
          <User size={18} />
        </button>
        <GoogleLoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
      </>
    )
  }

  const avatarUrl =
    typeof user.user_metadata?.avatar_url === 'string'
      ? user.user_metadata.avatar_url
      : undefined

  function handleSignOut() {
    // "Sin guardar" = hay un diagrama vivo que nunca se ha persistido en BD
    // (currentDiagramId null → todavía es solo local).
    const { currentDiagram, currentDiagramId } = useStore.getState()
    const hasUnsaved = !!currentDiagram && currentDiagramId === null
    setMenuOpen(false)
    if (hasUnsaved) {
      const ok = window.confirm(
        'Tienes un diagrama sin guardar. Si cierras sesión se perderá. ¿Cerrar sesión de todos modos?',
      )
      if (!ok) return
    }
    // Cerrar sesión limpia el workspace vivo (canvas + chat) y el historial
    // undo/redo, igual que "Nuevo diagrama": el usuario queda en lienzo en
    // blanco, sin restos del diagrama de la sesión anterior.
    void signOut()
    useStore.getState().newDiagram()
    useHistoryStore.getState().reset()
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setMenuOpen((o) => !o)}
        className={frame}
        title="Mi perfil"
        aria-label="Mi perfil"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <User size={18} />
        )}
      </button>
      {menuOpen && (
        // Se abre hacia arriba y a la derecha: el perfil vive al pie de la barra.
        <div
          role="menu"
          className="absolute bottom-0 left-full ml-2 z-50 min-w-[160px] border-[3px] border-[var(--color-ink)] rounded-[var(--radius)] bg-[var(--color-surface)] shadow-[var(--shadow-brutal)]"
        >
          <button
            role="menuitem"
            onClick={handleSignOut}
            className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 text-[var(--color-ink)] hover:bg-[var(--color-accent)]/10"
          >
            <LogOut size={14} />
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  )
}
