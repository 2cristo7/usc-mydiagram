import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// Tests del hook de sesión (useAuth) y de sus helpers sueltos (signInWithGoogle,
// signOut). Todo lo que el factory de vi.mock necesita vive en `h` (hoisted) para
// no chocar con el hoisting de vi.mock al inicio del archivo.
const h = vi.hoisted(() => ({
  getSessionResult: { data: { session: { user: { id: 'u1' } } } } as { data: { session: unknown } },
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithOAuth: vi.fn(),
  signOut: vi.fn(),
  unsubscribe: vi.fn(),
  authCb: undefined as undefined | ((event: string, session: unknown) => void),
  setSession: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: h.getSession,
      onAuthStateChange: h.onAuthStateChange,
      signInWithOAuth: h.signInWithOAuth,
      signOut: h.signOut,
    },
  },
}))
vi.mock('../store/auth', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ setSession: h.setSession }),
}))
vi.mock('../store/toast', () => ({ toast: h.toast }))

import { useAuth, signInWithGoogle, signOut } from '../hooks/useAuth'

beforeEach(() => {
  vi.clearAllMocks()
  h.authCb = undefined
  h.getSession.mockResolvedValue(h.getSessionResult)
  h.onAuthStateChange.mockImplementation((cb: (event: string, session: unknown) => void) => {
    h.authCb = cb
    return { data: { subscription: { unsubscribe: h.unsubscribe } } }
  })
})

describe('useAuth — montaje y suscripción', () => {
  it('al montar lee la sesión persistida y la fija en el store', async () => {
    renderHook(() => useAuth())
    // getSession es asíncrono: esperar a que la microtarea resuelva.
    await Promise.resolve()
    await Promise.resolve()
    expect(h.getSession).toHaveBeenCalledOnce()
    expect(h.setSession).toHaveBeenCalledWith(h.getSessionResult.data.session)
  })

  it('se suscribe a onAuthStateChange y propaga la sesión al store', async () => {
    renderHook(() => useAuth())
    expect(h.authCb).toBeDefined()
    h.setSession.mockClear()
    const nuevaSesion = { user: { id: 'u2' } }
    h.authCb!('SIGNED_IN', nuevaSesion)
    expect(h.setSession).toHaveBeenCalledWith(nuevaSesion)
  })

  it('al desmontar cancela la suscripción', () => {
    const { unmount } = renderHook(() => useAuth())
    unmount()
    expect(h.unsubscribe).toHaveBeenCalledOnce()
  })

  it('si getSession rechaza, no propaga la excepción (catch silencioso)', async () => {
    h.getSession.mockRejectedValueOnce(new Error('red caída'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useAuth())).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('signInWithGoogle', () => {
  it('devuelve true cuando el OAuth se inicia sin error', async () => {
    h.signInWithOAuth.mockResolvedValueOnce({ error: null })
    const ok = await signInWithGoogle()
    expect(ok).toBe(true)
    expect(h.toast.error).not.toHaveBeenCalled()
  })

  it('devuelve false y avisa si signInWithOAuth devuelve error', async () => {
    h.signInWithOAuth.mockResolvedValueOnce({ error: { message: 'popup bloqueado' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ok = await signInWithGoogle()
    expect(ok).toBe(false)
    expect(h.toast.error).toHaveBeenCalledOnce()
    spy.mockRestore()
  })

  it('devuelve false y avisa si la promesa rechaza (excepción)', async () => {
    h.signInWithOAuth.mockRejectedValueOnce(new Error('SDK roto'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ok = await signInWithGoogle()
    expect(ok).toBe(false)
    expect(h.toast.error).toHaveBeenCalledOnce()
    spy.mockRestore()
  })
})

describe('signOut', () => {
  it('no avisa cuando el cierre de sesión va bien', async () => {
    h.signOut.mockResolvedValueOnce({ error: null })
    await signOut()
    expect(h.signOut).toHaveBeenCalledOnce()
    expect(h.toast.error).not.toHaveBeenCalled()
  })

  it('avisa si signOut devuelve error', async () => {
    h.signOut.mockResolvedValueOnce({ error: { message: 'fallo' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await signOut()
    expect(h.toast.error).toHaveBeenCalledWith('No se pudo cerrar sesión.')
    spy.mockRestore()
  })

  it('avisa si la promesa rechaza (excepción)', async () => {
    h.signOut.mockRejectedValueOnce(new Error('red'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await signOut()
    expect(h.toast.error).toHaveBeenCalledWith('No se pudo cerrar sesión.')
    spy.mockRestore()
  })
})
