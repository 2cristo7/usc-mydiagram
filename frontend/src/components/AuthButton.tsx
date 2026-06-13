import { useAuthStore } from '../store/auth'
import { signInWithGoogle, signOut } from '../hooks/useAuth'
import { Button } from '../ui/primitives'

export function AuthButton() {
  const user = useAuthStore((s) => s.user)

  if (!user) {
    return (
      <Button variant="secondary" onClick={signInWithGoogle} className="text-xs px-2 py-1">
        Entrar con Google
      </Button>
    )
  }

  const avatarUrl =
    typeof user.user_metadata?.avatar_url === 'string'
      ? user.user_metadata.avatar_url
      : undefined

  return (
    <div className="flex items-center gap-2">
      {avatarUrl && (
        <img
          src={avatarUrl}
          alt=""
          className="h-7 w-7 border-[2px] border-[var(--color-ink)] rounded-full"
          referrerPolicy="no-referrer"
        />
      )}
      <Button variant="danger" onClick={signOut} className="text-xs px-2 py-1">
        Salir
      </Button>
    </div>
  )
}
