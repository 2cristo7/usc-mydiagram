import { useAuthStore } from '../store/auth'
import { signInWithGoogle, signOut } from '../hooks/useAuth'

// S9.2 — Control de sesión en la toolbar. Modo "login solo para guardar": la app
// es usable sin sesión, así que esto es un acceso opcional, no un muro.
export function AuthButton() {
  const user = useAuthStore((s) => s.user)

  if (!user) {
    return (
      <button
        onClick={signInWithGoogle}
        className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Continuar con Google
      </button>
    )
  }

  const avatarUrl = typeof user.user_metadata?.avatar_url === 'string'
    ? user.user_metadata.avatar_url
    : undefined

  return (
    <div className="flex items-center gap-2">
      {avatarUrl && (
        <img src={avatarUrl} alt="" className="h-7 w-7 rounded-full" referrerPolicy="no-referrer" />
      )}
      <span className="max-w-[160px] truncate text-sm text-gray-700">{user.email}</span>
      <button
        onClick={signOut}
        className="rounded border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
      >
        Salir
      </button>
    </div>
  )
}
