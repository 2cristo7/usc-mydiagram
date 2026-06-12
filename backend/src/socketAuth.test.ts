import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Socket } from 'socket.io'
import { isConnectionFresh, assertFreshToken, handleAuthRefresh } from './socketAuth'

// S10.1 — Frescura del token en sockets vivos. La verificación cripto solo entra
// por handleAuthRefresh (verifySupabaseToken mockeado); el camino caliente
// (isConnectionFresh/assertFreshToken) es comparación pura de `exp` con `now`
// inyectable, sin red ni cripto.

vi.mock('./auth', () => ({ verifySupabaseToken: vi.fn() }))
import { verifySupabaseToken } from './auth'
const mockVerify = vi.mocked(verifySupabaseToken)

// Socket mínimo: solo lo que toca el módulo (data, emit, disconnect).
function fakeSocket(data: Record<string, unknown> = {}): Socket {
  return {
    data,
    emit: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as Socket
}

const SEC = 1000

describe('isConnectionFresh', () => {
  it('conexión anónima (sin tokenExp) → siempre fresca', () => {
    expect(isConnectionFresh(fakeSocket({ userId: null }), 10 * SEC)).toBe(true)
  })

  it('exp en el futuro → fresca', () => {
    const s = fakeSocket({ tokenExp: 100 }) // exp = 100s epoch
    expect(isConnectionFresh(s, 50 * SEC)).toBe(true)
  })

  it('exp en el pasado → caducada', () => {
    const s = fakeSocket({ tokenExp: 100 })
    expect(isConnectionFresh(s, 150 * SEC)).toBe(false)
  })

  it('frontera now == exp → caducada (estricto <)', () => {
    const s = fakeSocket({ tokenExp: 100 })
    expect(isConnectionFresh(s, 100 * SEC)).toBe(false)
  })
})

describe('assertFreshToken', () => {
  it('token vivo → true, sin emitir ni desconectar', () => {
    const s = fakeSocket({ tokenExp: 100 })
    expect(assertFreshToken(s, 50 * SEC)).toBe(true)
    expect(s.emit).not.toHaveBeenCalled()
    expect(s.disconnect).not.toHaveBeenCalled()
  })

  it('token caducado → false, emite auth:expired y desconecta', () => {
    const s = fakeSocket({ tokenExp: 100 })
    expect(assertFreshToken(s, 150 * SEC)).toBe(false)
    expect(s.emit).toHaveBeenCalledWith('auth:expired')
    expect(s.disconnect).toHaveBeenCalledWith(true)
  })

  it('conexión anónima → true, no corta', () => {
    const s = fakeSocket({ userId: null })
    expect(assertFreshToken(s, 1_000_000 * SEC)).toBe(true)
    expect(s.disconnect).not.toHaveBeenCalled()
  })
})

describe('handleAuthRefresh', () => {
  beforeEach(() => mockVerify.mockReset())

  it('token válido del MISMO usuario → renueva tokenExp, no corta', async () => {
    mockVerify.mockResolvedValue({ userId: 'u1', exp: 999 })
    const s = fakeSocket({ userId: 'u1', tokenExp: 100 })
    await handleAuthRefresh(s, 'fresh-token')
    expect(s.data.tokenExp).toBe(999)
    expect(s.disconnect).not.toHaveBeenCalled()
  })

  it('token válido de OTRO usuario → corta (identidad no cambia en caliente)', async () => {
    mockVerify.mockResolvedValue({ userId: 'attacker', exp: 999 })
    const s = fakeSocket({ userId: 'u1', tokenExp: 100 })
    await handleAuthRefresh(s, 'other-user-token')
    expect(s.data.tokenExp).toBe(100) // sin tocar
    expect(s.emit).toHaveBeenCalledWith('auth:expired')
    expect(s.disconnect).toHaveBeenCalledWith(true)
  })

  // El caso "verify lanza → corta" se cubre en el E2E (socketHandlers.e2e.test.ts):
  // vitest 4 surfacea como error del test cualquier mock que rechace/lance aunque
  // esté manejado (rastreo de mock.settledResults), pero a través del handler real
  // del socket la rejection queda contenida y el corte se verifica de extremo a extremo.

  it('payload sin token (no string) → no hace nada (ni verifica ni corta)', async () => {
    const s = fakeSocket({ userId: 'u1', tokenExp: 100 })
    await handleAuthRefresh(s, undefined)
    expect(mockVerify).not.toHaveBeenCalled()
    expect(s.disconnect).not.toHaveBeenCalled()
  })
})
