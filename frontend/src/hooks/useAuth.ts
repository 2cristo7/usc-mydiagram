import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import { toast } from '../store/toast'

// S9.2 — Inicializa y mantiene la sesión. Se llama UNA vez (en App): lee la
// sesión persistida (localStorage o el redirect OAuth recién vuelto) y se
// suscribe a los cambios (login, logout, refresh automático del token).
export function useAuth() {
  const setSession = useAuthStore((s) => s.setSession)

  useEffect(() => {
    // El catch es silencioso al arrancar: no molestamos al usuario con un toast
    // si simplemente no hay sesión persistida o la red tarda en responder.
    supabase.auth.getSession()
      .then(({ data }) => setSession(data.session))
      .catch((err: unknown) => console.error('[useAuth] getSession falló:', err))

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => sub.subscription.unsubscribe()
  }, [setSession])
}

// Contrato 1 — devuelve true si el OAuth se inició correctamente (el navegador
// redirige a Google), false si falló ANTES de redirigir (popup bloqueado, OAuth
// mal configurado, red caída). El toast de error ya se muestra aquí; el llamante
// usa el booleano para decidir si apagar su spinner (cuando hay redirect real, el
// componente se desmonta con la navegación y nunca lee el resultado).
export async function signInWithGoogle(): Promise<boolean> {
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      // Vuelve a la misma URL de la app; Supabase debe tenerla en Redirect URLs.
      options: { redirectTo: window.location.origin },
    })
    // signInWithOAuth normalmente inicia el redirect y no devuelve error; pero si
    // falla antes de redirigir (popup bloqueado, OAuth mal configurado, red caída)
    // devuelve { error } sin lanzar excepción — hay que comprobarlo explícitamente.
    if (error) {
      console.error('[useAuth] signInWithGoogle error:', error)
      toast.error('No se pudo iniciar sesión con Google. Inténtalo de nuevo.')
      return false
    }
    return true
  } catch (err) {
    // Captura fallos inesperados de red o del SDK que rechazan la promesa.
    console.error('[useAuth] signInWithGoogle excepción:', err)
    toast.error('No se pudo iniciar sesión con Google. Inténtalo de nuevo.')
    return false
  }
}

export async function signOut() {
  try {
    const { error } = await supabase.auth.signOut()
    if (error) {
      console.error('[useAuth] signOut error:', error)
      toast.error('No se pudo cerrar sesión.')
    }
  } catch (err) {
    console.error('[useAuth] signOut excepción:', err)
    toast.error('No se pudo cerrar sesión.')
  }
}
