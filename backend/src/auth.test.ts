import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

// S9.4 — Tests de la frontera de autenticación (S9.2/9.3).
//
// `jose` se mockea entero: no queremos red ni un JWKS real, solo verificar que
// verifySupabaseToken pasa issuer/audience correctos y extrae el `sub`, y que el
// middleware requireAuth corta sin sesión y, en el camino válido, CONSERVA el
// token crudo en req.accessToken (lo que la RLS de 9.3 necesita reenviar).

const jwtVerify = vi.fn()
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => 'jwks-fn'),
  jwtVerify: (...args: unknown[]) => jwtVerify(...args),
}))

beforeAll(() => {
  process.env.SUPABASE_URL = 'https://proj.supabase.co'
})

import { verifySupabaseToken, requireAuth, type AuthedRequest } from './auth'
import type { Response } from 'express'

describe('verifySupabaseToken', () => {
  beforeEach(() => vi.clearAllMocks())

  it('verifica con issuer y audience de Supabase y devuelve userId + email', async () => {
    jwtVerify.mockResolvedValueOnce({ payload: { sub: 'user-123', email: 'a@b.com' } })
    const res = await verifySupabaseToken('tok')
    expect(res).toEqual({ userId: 'user-123', email: 'a@b.com' })
    const [token, , opts] = jwtVerify.mock.calls[0]
    expect(token).toBe('tok')
    expect(opts).toEqual({ issuer: 'https://proj.supabase.co/auth/v1', audience: 'authenticated' })
  })

  it('lanza si el token no trae claim sub (sin user_id no hay identidad)', async () => {
    jwtVerify.mockResolvedValueOnce({ payload: { email: 'a@b.com' } })
    await expect(verifySupabaseToken('tok')).rejects.toThrow(/sub/)
  })

  it('propaga el fallo de jose (firma/expiración/issuer inválidos)', async () => {
    jwtVerify.mockRejectedValueOnce(new Error('signature verification failed'))
    await expect(verifySupabaseToken('tok')).rejects.toThrow(/signature/)
  })
})

// Helpers para invocar el middleware en aislamiento, sin Express real.
function mockRes(): Response & { _status?: number; _json?: unknown } {
  const res = {} as Response & { _status?: number; _json?: unknown }
  res.status = vi.fn((code: number) => {
    res._status = code
    return res
  }) as unknown as Response['status']
  res.json = vi.fn((body: unknown) => {
    res._json = body
    return res
  }) as unknown as Response['json']
  return res
}

describe('requireAuth', () => {
  beforeEach(() => vi.clearAllMocks())

  it('401 si falta el header Authorization (sin sesión no se persiste)', async () => {
    const req = { headers: {} } as AuthedRequest
    const res = mockRes()
    const next = vi.fn()
    await requireAuth(req, res, next)
    expect(res._status).toBe(401)
    expect(res._json).toEqual({ error: 'Falta el token de sesión' })
    expect(next).not.toHaveBeenCalled()
  })

  it('401 si el header no usa el esquema Bearer', async () => {
    const req = { headers: { authorization: 'Basic abc' } } as AuthedRequest
    const res = mockRes()
    const next = vi.fn()
    await requireAuth(req, res, next)
    expect(res._status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('401 (Token inválido) si jose rechaza — no degrada a anónimo', async () => {
    jwtVerify.mockRejectedValueOnce(new Error('expired'))
    const req = { headers: { authorization: 'Bearer rotten' } } as AuthedRequest
    const res = mockRes()
    const next = vi.fn()
    await requireAuth(req, res, next)
    expect(res._status).toBe(401)
    expect(res._json).toEqual({ error: 'Token inválido' })
    expect(next).not.toHaveBeenCalled()
  })

  it('token válido → next() Y conserva el token CRUDO en req.accessToken (RLS lo reenvía)', async () => {
    jwtVerify.mockResolvedValueOnce({ payload: { sub: 'user-123' } })
    const req = { headers: { authorization: 'Bearer raw-jwt-xyz' } } as AuthedRequest
    const res = mockRes()
    const next = vi.fn()
    await requireAuth(req, res, next)
    expect(next).toHaveBeenCalledOnce()
    expect(req.userId).toBe('user-123')
    // El invariante de 9.3: el token viaja intacto para que supabaseForUser lo
    // reenvíe y auth.uid() resuelva al usuario real. Si se mutara, la RLS caería.
    expect(req.accessToken).toBe('raw-jwt-xyz')
    expect(res._status).toBeUndefined()
  })
})
