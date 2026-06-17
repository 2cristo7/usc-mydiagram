import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'

// S9.2 — Estado de sesión, separado del store de diagrama/chat (responsabilidad
// distinta). `user` se deriva de la sesión para que los componentes que solo
// pintan el avatar no dependan del token completo.
interface AuthStore {
  session: Session | null
  user: User | null
  // false hasta que getSession() resuelve por primera vez. Evita el parpadeo
  // "invitado → logueado" al arrancar: la UI puede mostrar carga mientras tanto.
  initialized: boolean
  setSession: (session: Session | null) => void
}

export const useAuthStore = create<AuthStore>()((set) => ({
  session: null,
  user: null,
  initialized: false,
  setSession: (session) => set({ session, user: session?.user ?? null, initialized: true }),
}))
