import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'

// S9.2 — Inicializa y mantiene la sesión. Se llama UNA vez (en App): lee la
// sesión persistida (localStorage o el redirect OAuth recién vuelto) y se
// suscribe a los cambios (login, logout, refresh automático del token).
export function useAuth() {
  const setSession = useAuthStore((s) => s.setSession)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => sub.subscription.unsubscribe()
  }, [setSession])
}

export async function signInWithGoogle() {
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    // Vuelve a la misma URL de la app; Supabase debe tenerla en Redirect URLs.
    options: { redirectTo: window.location.origin },
  })
}

export async function signOut() {
  await supabase.auth.signOut()
}
