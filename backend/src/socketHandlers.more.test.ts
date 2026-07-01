import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest'
import { createServer, type Server as HttpServer } from 'http'
import type { AddressInfo } from 'net'
import express from 'express'
import request from 'supertest'
import { Server } from 'socket.io'
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client'

// Cobertura adicional del wiring de socket (socketHandlers.ts): el router interno
// /internal/llm (proxy del LLM al navegador), la resolución de la config LLM
// (anónima vía push del navegador / autenticada vía RPC de Supabase), los handlers
// de refinamiento y clarificación, el rate limit, el cache HIT, los ACK de las
// keys/config transitorias y el cleanup de pendientes al desconectar.
//
// Se mockean ./auth (handshake JWT) y ./supabase (RPC de config LLM) para no tocar
// red ni BD. El agente (streamAgentToSocket) y la admisión (rate limit + caché) se
// inyectan como dobles controlables por test.

vi.mock('./auth', () => ({ verifySupabaseToken: vi.fn() }))

// RPC de Supabase para la config LLM del usuario autenticado. rpcMock decide la
// respuesta por test; supabaseForUser devuelve un cliente con .rpc.
const rpcMock = vi.fn()
vi.mock('./supabase', () => ({
  supabaseForUser: vi.fn(() => ({ rpc: (...a: unknown[]) => rpcMock(...a) })),
}))

import { verifySupabaseToken } from './auth'
import { attachAgentHandlers, createInternalLlmRouter, pendingLlmRequests } from './socketHandlers'

const mockVerify = vi.mocked(verifySupabaseToken)
const now = () => Math.floor(Date.now() / 1000)

let httpServer: HttpServer
let io: Server
let port: number
let client: ClientSocket | undefined

// Doble del agente: captura la llamada e invoca el onDone (5º arg) si se le pasa,
// para ejercitar el callback de cacheo de runGeneration. La config LLM llega como
// 6º argumento; los tests la inspeccionan vía streamMock.mock.calls.
const streamMock = vi.fn(
  async (
    _url: string,
    _body: unknown,
    socket?: { emit: (e: string, p: unknown) => void },
    onDone?: (done: any) => void,
    _llmConfig?: unknown,
  ) => {
    if (!socket) return
    const done = { title: 't', degraded: false, degradations: [], refinement_history: [], diagram: { nodes: [{}], edges: [] } }
    if (onDone) onDone(done)
    socket.emit('diagram:done', done)
  },
)

const getCachedMock = vi.fn(async () => null as unknown)
const setCachedMock = vi.fn(() => {})
const rateLimitMock = vi.fn(() => true)

function waitFor<T = unknown>(socket: ClientSocket, event: string, timeout = 2500): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout esperando '${event}'`)), timeout)
    socket.once(event, (data: T) => { clearTimeout(timer); resolve(data) })
  })
}

function connect(token?: string): Promise<ClientSocket> {
  const c = ioc(`http://localhost:${port}`, {
    transports: ['websocket'],
    auth: token ? { token } : {},
    forceNew: true,
    reconnection: false,
  })
  client = c
  return waitFor(c, 'connect').then(() => c)
}

let app: express.Express

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})

  mockVerify.mockImplementation(async (token: string) => {
    if (token === 'fresh') return { userId: 'u1', exp: now() + 3600 }
    throw new Error('token desconocido')
  })

  process.env.INTERNAL_PROXY_SECRET = 'internal-secret'

  httpServer = createServer()
  io = new Server(httpServer, { cors: { origin: '*' } })
  attachAgentHandlers(io, {
    streamAgentToSocket: streamMock as never,
    checkRateLimit: rateLimitMock,
    getCached: getCachedMock as never,
    setCached: setCachedMock as never,
    agentBaseUrl: 'http://agent.invalid',
  })

  app = express()
  app.use(express.json())
  app.use('/internal/llm', createInternalLlmRouter(io))

  return new Promise<void>((resolve) => {
    httpServer.listen(0, () => {
      port = (httpServer.address() as AddressInfo).port
      resolve()
    })
  })
})

beforeEach(() => {
  streamMock.mockClear()
  getCachedMock.mockClear()
  getCachedMock.mockResolvedValue(null)
  setCachedMock.mockClear()
  rateLimitMock.mockClear()
  rateLimitMock.mockReturnValue(true)
  rpcMock.mockReset()
  pendingLlmRequests.clear()
})

afterEach(() => { client?.disconnect(); client = undefined })
afterAll(() => { io.close(); httpServer.close(); vi.restoreAllMocks() })

describe('router interno /internal/llm (proxy LLM al navegador)', () => {
  it('401 sin el header X-Internal-Token correcto', async () => {
    const res = await request(app).post('/internal/llm').send({ proxy_session: 'x' })
    expect(res.status).toBe(401)
  })

  it('400 si falta proxy_session', async () => {
    const res = await request(app)
      .post('/internal/llm')
      .set('X-Internal-Token', 'internal-secret')
      .send({ model: 'm' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/proxy_session/)
  })

  it('409 si el socket del navegador no está conectado', async () => {
    const res = await request(app)
      .post('/internal/llm')
      .set('X-Internal-Token', 'internal-secret')
      .send({ proxy_session: 'socket-inexistente' })
    expect(res.status).toBe(409)
    expect(res.body.error_code).toBe('browser_disconnected')
  })

  it('200: emite llm:request al navegador y resuelve con su llm:response', async () => {
    const c = await connect('fresh')
    // El navegador responde a la petición proxy con el contenido del LLM.
    c.on('llm:request', ({ request_id }: { request_id: string }) => {
      c.emit('llm:response', { request_id, content: 'respuesta-del-modelo' })
    })
    const res = await request(app)
      .post('/internal/llm')
      .set('X-Internal-Token', 'internal-secret')
      .send({ proxy_session: c.id, model: 'gpt-4o', messages: [], options: {}, think: false })
    expect(res.status).toBe(200)
    expect(res.body.content).toBe('respuesta-del-modelo')
  })

  it('502: si el navegador devuelve llm:error, propaga el error_code', async () => {
    const c = await connect('fresh')
    c.on('llm:request', ({ request_id }: { request_id: string }) => {
      c.emit('llm:error', { request_id, error_code: 'browser_error', detail: 'rate limited' })
    })
    const res = await request(app)
      .post('/internal/llm')
      .set('X-Internal-Token', 'internal-secret')
      .send({ proxy_session: c.id, model: 'm', messages: [] })
    expect(res.status).toBe(502)
    expect(res.body.error_code).toBe('browser_error')
    expect(res.body.detail).toBe('rate limited')
  })
})

describe('admisión: rate limit y caché en runGeneration', () => {
  it('rate limit superado → diagram:error category=rate_limit, sin llamar al agente', async () => {
    rateLimitMock.mockReturnValue(false)
    const c = await connect('fresh')
    const err = await Promise.race([
      waitFor<{ category: string }>(c, 'diagram:error'),
      (async () => { c.emit('message:send', 'haz un ERD'); return waitFor<{ category: string }>(c, 'diagram:error') })(),
    ])
    expect(err.category).toBe('rate_limit')
    expect(streamMock).not.toHaveBeenCalled()
  })

  it('cache HIT → sirve diagram:done desde caché sin llamar al agente', async () => {
    getCachedMock.mockResolvedValue({ title: 'Cacheado', diagram: { nodes: [{}], edges: [] } })
    const c = await connect('fresh')
    c.emit('message:send', 'haz un ERD')
    const done = await waitFor<{ title: string }>(c, 'diagram:done')
    expect(done.title).toBe('Cacheado')
    expect(streamMock).not.toHaveBeenCalled()
  })

  it('cache MISS → llama al agente y cachea el resultado limpio (onDone → setCached)', async () => {
    getCachedMock.mockResolvedValue(null)
    const c = await connect('fresh')
    c.emit('message:send', { prompt: 'haz un ERD', diagram_type: 'erd' })
    await waitFor(c, 'diagram:done')
    expect(streamMock).toHaveBeenCalledOnce()
    // El callback de cacheo se ejecutó con el resultado limpio (≥1 nodo, no degradado).
    expect(setCachedMock).toHaveBeenCalled()
    const [prompt, , , type] = setCachedMock.mock.calls[0] as unknown as [string, unknown, unknown, string]
    expect(prompt).toBe('haz un ERD')
    expect(type).toBe('erd')
  })

  it('message:regenerate ignora la caché (no llama a getCached) y fuerza el agente', async () => {
    const c = await connect('fresh')
    c.emit('message:regenerate', { prompt: 'haz un ERD' })
    await waitFor(c, 'diagram:done')
    expect(getCachedMock).not.toHaveBeenCalled()
    expect(streamMock).toHaveBeenCalledOnce()
  })

  it('message:regenerate sin prompt no hace nada (return temprano)', async () => {
    const c = await connect('fresh')
    c.emit('message:regenerate', { prompt: '' })
    // Damos un margen para asegurar que el agente NO se invoca.
    await new Promise((r) => setTimeout(r, 60))
    expect(streamMock).not.toHaveBeenCalled()
  })
})

describe('handlers de refinamiento y clarificación', () => {
  it('message:refine llama al endpoint /refine/stream con el diagrama adjunto', async () => {
    const c = await connect('fresh')
    c.emit('message:refine', { prompt: 'añade Carrito', diagram: { diagram_type: 'erd', nodes: [{}], edges: [] } })
    await waitFor(c, 'diagram:done')
    const [url, body] = streamMock.mock.calls[0] as unknown as [string, { prompt: string }]
    expect(url).toBe('http://agent.invalid/refine/stream')
    expect(body.prompt).toBe('añade Carrito')
  })

  it('message:refine respeta el rate limit', async () => {
    rateLimitMock.mockReturnValue(false)
    const c = await connect('fresh')
    c.emit('message:refine', { prompt: 'x', diagram: { nodes: [], edges: [] } })
    const err = await waitFor<{ category: string }>(c, 'diagram:error')
    expect(err.category).toBe('rate_limit')
    expect(streamMock).not.toHaveBeenCalled()
  })

  it('message:clarification_answer llama a /refine/resume con thread_id y answer', async () => {
    const c = await connect('fresh')
    c.emit('message:clarification_answer', { thread_id: 'th-1', answer: 'sí, con auth' })
    await waitFor(c, 'diagram:done')
    const [url, body] = streamMock.mock.calls[0] as unknown as [string, { thread_id: string; answer: string }]
    expect(url).toBe('http://agent.invalid/refine/resume')
    expect(body.thread_id).toBe('th-1')
    expect(body.answer).toBe('sí, con auth')
  })

  it('message:clarification_answer respeta el rate limit', async () => {
    rateLimitMock.mockReturnValue(false)
    const c = await connect('fresh')
    c.emit('message:clarification_answer', { thread_id: 't', answer: 'a' })
    const err = await waitFor<{ category: string }>(c, 'diagram:error')
    expect(err.category).toBe('rate_limit')
  })
})

describe('config LLM: ACKs y resolución', () => {
  it('llm:set_transient_key responde ACK {ok:true} y registra la key', async () => {
    const c = await connect('fresh')
    const ack = await new Promise<{ ok: boolean }>((resolve) => {
      c.emit('llm:set_transient_key', { provider: 'openai', api_key: 'sk-123' }, resolve)
    })
    expect(ack.ok).toBe(true)
  })

  it('llm:set_transient_key con payload inválido también ACKea (y olvida la key)', async () => {
    const c = await connect('fresh')
    const ack = await new Promise<{ ok: boolean }>((resolve) => {
      c.emit('llm:set_transient_key', { provider: 'openai' }, resolve) // sin api_key
    })
    expect(ack.ok).toBe(true)
  })

  it('llm:set_local_config responde ACK {ok:true}', async () => {
    const c = await connect() // anónimo
    const ack = await new Promise<{ ok: boolean }>((resolve) => {
      c.emit('llm:set_local_config', {
        provider: 'ollama', transport: 'http', model_fast: 'qwen3:1.7b', model_capable: 'qwen3:8b',
      }, resolve)
    })
    expect(ack.ok).toBe(true)
  })

  it('llm:set_local_config inválido también ACKea (y olvida la config)', async () => {
    const c = await connect()
    const ack = await new Promise<{ ok: boolean }>((resolve) => {
      c.emit('llm:set_local_config', { provider: 'ollama' }, resolve) // faltan modelos
    })
    expect(ack.ok).toBe(true)
  })

  it('anónimo con config local push → la config viaja al agente en la generación', async () => {
    const c = await connect() // sin token → anónimo
    await new Promise<void>((resolve) => {
      c.emit('llm:set_local_config', {
        provider: 'ollama', transport: 'http', model_fast: 'qwen3:1.7b', model_capable: 'qwen3:8b', base_url: 'http://ollama:11434',
      }, () => resolve())
    })
    c.emit('message:send', 'haz un ERD')
    await waitFor(c, 'diagram:done')
    const llmConfig = streamMock.mock.calls[0][4] as { provider: string; transport: string; base_url: string }
    expect(llmConfig.provider).toBe('ollama')
    expect(llmConfig.transport).toBe('http')
    expect(llmConfig.base_url).toBe('http://ollama:11434')
  })

  it('anónimo con proveedor comercial + key transitoria → la key entra en la config', async () => {
    const c = await connect()
    await new Promise<void>((resolve) => {
      c.emit('llm:set_local_config', {
        provider: 'openai', transport: 'browser', model_fast: 'gpt-4o-mini', model_capable: 'gpt-4o',
      }, () => resolve())
    })
    await new Promise<void>((resolve) => {
      c.emit('llm:set_transient_key', { provider: 'openai', api_key: 'sk-abc' }, () => resolve())
    })
    c.emit('message:send', 'haz un ERD')
    await waitFor(c, 'diagram:done')
    const llmConfig = streamMock.mock.calls[0][4] as { provider: string; api_key: string | null; proxy_session: string | null }
    expect(llmConfig.provider).toBe('openai')
    expect(llmConfig.api_key).toBe('sk-abc')
    // transport=browser → proxy_session es el socket.id
    expect(typeof llmConfig.proxy_session).toBe('string')
  })

  it('anónimo SIN config local → llmConfig undefined (defaults del agente)', async () => {
    const c = await connect()
    c.emit('message:send', 'haz un ERD')
    await waitFor(c, 'diagram:done')
    expect(streamMock.mock.calls[0][4]).toBeUndefined()
  })

  it('autenticado → resolveLlmConfig lee la config vía RPC get_llm_config', async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === 'get_llm_config') {
        return { data: { provider: 'ollama', transport: 'http', model_fast: 'qwen3:1.7b', model_capable: 'qwen3:8b', base_url: null, saved_providers: [] }, error: null }
      }
      return { data: null, error: null }
    })
    const c = await connect('fresh')
    c.emit('message:send', 'haz un ERD')
    await waitFor(c, 'diagram:done')
    const llmConfig = streamMock.mock.calls[0][4] as { provider: string }
    expect(llmConfig.provider).toBe('ollama')
    expect(rpcMock).toHaveBeenCalledWith('get_llm_config')
  })

  it('autenticado con key persistida → descifra vía RPC get_llm_api_key', async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === 'get_llm_config') {
        return { data: { provider: 'openai', transport: 'http', model_fast: 'gpt-4o-mini', model_capable: 'gpt-4o', base_url: null, saved_providers: ['openai'] }, error: null }
      }
      if (fn === 'get_llm_api_key') return { data: 'sk-persisted', error: null }
      return { data: null, error: null }
    })
    const c = await connect('fresh')
    c.emit('message:send', 'haz un ERD')
    await waitFor(c, 'diagram:done')
    const llmConfig = streamMock.mock.calls[0][4] as { api_key: string }
    expect(llmConfig.api_key).toBe('sk-persisted')
    expect(rpcMock).toHaveBeenCalledWith('get_llm_api_key', { p_provider: 'openai' })
  })

  it('autenticado pero el RPC de config falla → llmConfig undefined (no rompe la generación)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'rpc boom' } })
    const c = await connect('fresh')
    c.emit('message:send', 'haz un ERD')
    await waitFor(c, 'diagram:done')
    expect(streamMock.mock.calls[0][4]).toBeUndefined()
  })
})

describe('disconnect: cleanup de peticiones LLM pendientes', () => {
  it('al desconectar el navegador, /internal/llm pendiente se rechaza con browser_disconnected (502)', async () => {
    const c = await connect('fresh')
    const sid = c.id!
    // No respondemos a llm:request: la petición queda pendiente. Al desconectar el
    // socket, el handler de disconnect rechaza los pendientes de ESE socket.
    // `.then(...)` arranca la petición (supertest dispatcha de forma perezosa).
    const pending = request(app)
      .post('/internal/llm')
      .set('X-Internal-Token', 'internal-secret')
      .send({ proxy_session: sid, model: 'm', messages: [] })
      .then((r) => r)
    // Esperar a que el pending quede registrado antes de desconectar.
    await vi.waitFor(() => expect(pendingLlmRequests.size).toBeGreaterThan(0))
    c.disconnect()
    const res = await pending
    expect(res.status).toBe(502)
    expect(res.body.error_code).toBe('browser_disconnected')
  })
})
