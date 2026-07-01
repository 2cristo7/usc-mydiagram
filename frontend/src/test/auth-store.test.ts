import { beforeEach, describe, expect, it } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import { useAuthStore } from '../store/auth'

beforeEach(() => {
  useAuthStore.setState({ session: null, user: null, initialized: false })
})

// Sesión mínima: solo los campos que el store lee (user + access_token).
function fakeSession(): Session {
  return {
    access_token: 'tok-abc',
    refresh_token: 'ref',
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: 'u1', email: 'a@b.com' },
  } as unknown as Session
}

describe('auth store', () => {
  it('estado inicial: sin sesión ni usuario, no inicializado', () => {
    const s = useAuthStore.getState()
    expect(s.session).toBeNull()
    expect(s.user).toBeNull()
    expect(s.initialized).toBe(false)
  })

  it('setSession con sesión deriva el user y marca initialized', () => {
    const session = fakeSession()
    useAuthStore.getState().setSession(session)
    const s = useAuthStore.getState()
    expect(s.session).toBe(session)
    expect(s.user).toEqual(session.user)
    expect(s.initialized).toBe(true)
  })

  it('setSession(null) limpia user pero igualmente marca initialized', () => {
    useAuthStore.getState().setSession(fakeSession())
    useAuthStore.getState().setSession(null)
    const s = useAuthStore.getState()
    expect(s.session).toBeNull()
    expect(s.user).toBeNull()
    // Tras la primera resolución de getSession, initialized queda true aunque sea logout.
    expect(s.initialized).toBe(true)
  })
})
