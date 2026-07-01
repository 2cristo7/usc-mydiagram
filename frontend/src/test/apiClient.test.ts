import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import {
  listVersions,
  getVersion,
  listDiagrams,
  getDiagram,
  renameDiagram,
  deleteDiagram,
  listTrash,
  restoreDiagram,
  deleteDiagramPermanent,
  emptyTrash,
  getLlmConfig,
  putLlmConfig,
  deleteLlmApiKey,
  deleteAccount,
} from '../lib/api'
import { useAuthStore } from '../store/auth'

const BASE = 'http://localhost:3001'

function login() {
  useAuthStore.setState({
    session: { access_token: 'tok-xyz', user: { id: 'u1' } } as unknown as Session,
    user: { id: 'u1' } as unknown as Session['user'],
    initialized: true,
  })
}
function logout() {
  useAuthStore.setState({ session: null, user: null, initialized: true })
}

// Respuesta fetch falsa con json()/blob() configurables.
function jsonRes(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  login()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('api — GET con auth', () => {
  it('listVersions devuelve la metadata en éxito', async () => {
    const data = [{ id: 'v1', seq: 1 }]
    fetchMock.mockResolvedValue(jsonRes(data))
    await expect(listVersions('d1')).resolves.toEqual(data)
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/diagrams/d1/versions`, expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer tok-xyz' }),
    }))
  })

  it('listVersions sin sesión devuelve [] sin pegar a la red', async () => {
    logout()
    await expect(listVersions('d1')).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('listVersions lanza ante respuesta no-ok', async () => {
    fetchMock.mockResolvedValue(jsonRes({}, false, 500))
    await expect(listVersions('d1')).rejects.toThrow(/HTTP 500/)
  })

  it('getVersion sin sesión lanza "Sesión requerida"', async () => {
    logout()
    await expect(getVersion('d1', 'v1')).rejects.toThrow('Sesión requerida')
  })

  it('getVersion lanza ante no-ok', async () => {
    fetchMock.mockResolvedValue(jsonRes({}, false, 404))
    await expect(getVersion('d1', 'v1')).rejects.toThrow(/HTTP 404/)
  })

  it('getVersion devuelve la fila en éxito', async () => {
    const row = { id: 'v1', diagram_id: 'd1', user_id: 'u1', data: {} }
    fetchMock.mockResolvedValue(jsonRes(row))
    await expect(getVersion('d1', 'v1')).resolves.toEqual(row)
  })

  it('listDiagrams sin sesión lanza "Sesión requerida"', async () => {
    logout()
    await expect(listDiagrams()).rejects.toThrow('Sesión requerida')
  })

  it('listDiagrams devuelve la lista en éxito', async () => {
    fetchMock.mockResolvedValue(jsonRes([{ id: 'd1' }]))
    await expect(listDiagrams()).resolves.toEqual([{ id: 'd1' }])
  })

  it('listDiagrams lanza ante no-ok', async () => {
    fetchMock.mockResolvedValue(jsonRes({}, false, 403))
    await expect(listDiagrams()).rejects.toThrow(/HTTP 403/)
  })

  it('getDiagram lanza el mensaje legible si json() falla (2xx con cuerpo no-JSON)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error('Unexpected token')),
    } as unknown as Response)
    await expect(getDiagram('d1')).rejects.toThrow('Respuesta inesperada del servidor al cargar el diagrama.')
  })

  it('listTrash devuelve la papelera', async () => {
    fetchMock.mockResolvedValue(jsonRes([{ id: 't1' }]))
    await expect(listTrash()).resolves.toEqual([{ id: 't1' }])
  })

  it('listTrash sin sesión lanza', async () => {
    logout()
    await expect(listTrash()).rejects.toThrow('Sesión requerida')
  })

  it('getLlmConfig devuelve la config', async () => {
    const cfg = { provider: 'openai', transport: 'api', model_fast: 'f', model_capable: 'c', saved_providers: [] }
    fetchMock.mockResolvedValue(jsonRes(cfg))
    await expect(getLlmConfig()).resolves.toEqual(cfg)
  })

  it('getLlmConfig lanza ante no-ok', async () => {
    fetchMock.mockResolvedValue(jsonRes({}, false, 500))
    await expect(getLlmConfig()).rejects.toThrow(/configuración LLM/)
  })
})

describe('api — mutaciones (PATCH/POST/PUT/DELETE)', () => {
  it('renameDiagram devuelve la metadata y manda el método PATCH', async () => {
    const meta = { id: 'd1', title: 'Nuevo' }
    fetchMock.mockResolvedValue(jsonRes(meta))
    await expect(renameDiagram('d1', 'Nuevo')).resolves.toEqual(meta)
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/diagrams/d1/rename`, expect.objectContaining({ method: 'PATCH' }))
  })

  it('renameDiagram usa detail.error del cuerpo cuando viene', async () => {
    fetchMock.mockResolvedValue(jsonRes({ error: 'nombre en uso' }, false, 409))
    await expect(renameDiagram('d1', 'X')).rejects.toThrow('nombre en uso')
  })

  it('renameDiagram cae al mensaje HTTP si el cuerpo de error no es JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('no json')),
    } as unknown as Response)
    await expect(renameDiagram('d1', 'X')).rejects.toThrow(/HTTP 500/)
  })

  it('deleteDiagram resuelve en éxito (DELETE)', async () => {
    fetchMock.mockResolvedValue(jsonRes(null, true, 204))
    await expect(deleteDiagram('d1')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/diagrams/d1`, expect.objectContaining({ method: 'DELETE' }))
  })

  it('deleteDiagram lanza ante no-ok', async () => {
    fetchMock.mockResolvedValue(jsonRes({}, false, 500))
    await expect(deleteDiagram('d1')).rejects.toThrow(/eliminar el diagrama/)
  })

  it('restoreDiagram hace POST y resuelve', async () => {
    fetchMock.mockResolvedValue(jsonRes(null, true))
    await expect(restoreDiagram('d1')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/diagrams/d1/restore`, expect.objectContaining({ method: 'POST' }))
  })

  it('deleteDiagramPermanent lanza ante no-ok', async () => {
    fetchMock.mockResolvedValue(jsonRes({}, false, 500))
    await expect(deleteDiagramPermanent('d1')).rejects.toThrow(/definitivamente/)
  })

  it('emptyTrash hace DELETE a /diagrams/trash', async () => {
    fetchMock.mockResolvedValue(jsonRes(null, true))
    await expect(emptyTrash()).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/diagrams/trash`, expect.objectContaining({ method: 'DELETE' }))
  })

  it('putLlmConfig resuelve en éxito', async () => {
    fetchMock.mockResolvedValue(jsonRes(null, true))
    await expect(
      putLlmConfig({ provider: 'openai', transport: 'api', model_fast: 'f', model_capable: 'c' }),
    ).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/llm-config`, expect.objectContaining({ method: 'PUT' }))
  })

  it('putLlmConfig usa detail.error en fallo', async () => {
    fetchMock.mockResolvedValue(jsonRes({ error: 'key inválida' }, false, 400))
    await expect(
      putLlmConfig({ provider: 'openai', transport: 'api', model_fast: 'f', model_capable: 'c' }),
    ).rejects.toThrow('key inválida')
  })

  it('deleteLlmApiKey codifica el proveedor en la URL', async () => {
    fetchMock.mockResolvedValue(jsonRes(null, true))
    await expect(deleteLlmApiKey('open ai')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/llm-config/api-key/open%20ai`, expect.objectContaining({ method: 'DELETE' }))
  })

  it('deleteAccount lanza con detail.error', async () => {
    fetchMock.mockResolvedValue(jsonRes({ error: 'no se pudo' }, false, 500))
    await expect(deleteAccount()).rejects.toThrow('no se pudo')
  })
})

describe('api — timeout y errores de red', () => {
  it('un AbortError se traduce a mensaje legible de timeout', async () => {
    fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'))
    await expect(listDiagrams()).rejects.toThrow('La petición tardó demasiado. Revisa tu conexión.')
  })

  it('otros errores de red se propagan intactos', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(listDiagrams()).rejects.toThrow('Failed to fetch')
  })

  it('sin sesión las mutaciones lanzan "Sesión requerida" sin pegar a la red', async () => {
    logout()
    await expect(renameDiagram('d1', 'X')).rejects.toThrow('Sesión requerida')
    await expect(deleteAccount()).rejects.toThrow('Sesión requerida')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
