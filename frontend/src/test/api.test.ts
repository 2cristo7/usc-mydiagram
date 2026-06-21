import { describe, it, expect, vi, beforeEach } from 'vitest'

// S9.4 — Test de la cola de guardados de api.ts (S9.3).
//
// El riesgo que cubre: dos `diagram:done` seguidos (generación + refinamiento
// rápido) podrían disparar dos POST antes de que el primero fije currentDiagramId
// → un INSERT duplicado en BD. La cola serializa cada guardado tras el anterior,
// así el segundo ya ve el id y hace PATCH. Aquí se bloquea ese invariante.

// Estado mutable del store, hoisted para poder mutarlo desde setCurrentDiagramId
// y que la lectura FRESCA de getState() (dentro de doSave) vea el id ya fijado.
const h = vi.hoisted(() => {
  const state = {
    currentDiagram: { title: 'Blog', diagram_type: 'erd', nodes: [], edges: [] } as unknown,
    currentDiagramId: null as string | null,
    setCurrentDiagramId(id: string | null) {
      state.currentDiagramId = id
    },
  }
  const auth = { token: 'tok-123' as string | null }
  return { state, auth }
})

vi.mock('../store/index', () => ({ useStore: { getState: () => h.state } }))
vi.mock('../store/auth', () => ({
  useAuthStore: { getState: () => ({ session: h.auth.token ? { access_token: h.auth.token } : null }) },
}))

import { persistCurrentDiagram } from '../lib/api'

const fetchMock = vi.fn()
// @ts-expect-error — fetch global de test
global.fetch = fetchMock

function okResponse(id: string) {
  return { ok: true, json: async () => ({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.state.currentDiagramId = null
  h.auth.token = 'tok-123'
})

describe('persistCurrentDiagram', () => {
  it('sin sesión no llama a la red y devuelve no-session', async () => {
    h.auth.token = null
    const res = await persistCurrentDiagram()
    expect(res).toEqual({ ok: false, error: 'no-session' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('primer guardado = POST y cachea el id devuelto (para que el siguiente sea PATCH)', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('new-id'))
    const res = await persistCurrentDiagram({ instruction: 'crea un blog' })
    expect(res).toEqual({ ok: true, id: 'new-id' })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3001/diagrams')
    expect(opts.method).toBe('POST')
    expect(opts.headers.Authorization).toBe('Bearer tok-123')
    expect(h.state.currentDiagramId).toBe('new-id')
  })

  it('dos guardados encadenados → POST y luego PATCH del mismo id (anti doble-INSERT)', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('new-id')).mockResolvedValueOnce(okResponse('new-id'))
    // Disparados casi a la vez (sin await del primero): la cola los serializa.
    const p1 = persistCurrentDiagram()
    const p2 = persistCurrentDiagram()
    await Promise.all([p1, p2])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url1, opts1] = fetchMock.mock.calls[0]
    const [url2, opts2] = fetchMock.mock.calls[1]
    expect(opts1.method).toBe('POST')
    expect(url1).toBe('http://localhost:3001/diagrams')
    // El segundo ve ya el id fijado por el primero → PATCH, no un segundo POST.
    expect(opts2.method).toBe('PATCH')
    expect(url2).toBe('http://localhost:3001/diagrams/new-id')
  })

  it('un fallo de red no atasca la cola: el guardado siguiente vuelve a intentarse', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(okResponse('id-2'))
    const r1 = await persistCurrentDiagram()
    expect(r1.ok).toBe(false)
    const r2 = await persistCurrentDiagram()
    expect(r2.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('propaga el error del backend (status no-ok) con su detalle', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: 'Falta diagram_type' }) })
    const res = await persistCurrentDiagram()
    expect(res).toEqual({ ok: false, error: 'Falta diagram_type' })
  })
})
