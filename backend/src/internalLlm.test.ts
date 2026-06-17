import { describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach } from 'vitest'
import { createServer, type Server as HttpServer } from 'http'
import type { AddressInfo } from 'net'
import express from 'express'
import { Server } from 'socket.io'
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client'
import { createInternalLlmRouter, pendingLlmRequests } from './socketHandlers'

// S10.3 — Test del endpoint POST /internal/llm (proxy LLM browser).
//
// El agente Python llama a este endpoint con X-Internal-Token; el gateway emite
// llm:request al navegador del usuario y espera llm:response o llm:error.
//
// ARQUITECTURA DEL TEST:
// supertest puede recibir un HttpServer directamente; usamos el mismo httpServer
// en el que escucha socket.io para que socket.id sea un ID válido dentro del
// mismo io.sockets.sockets Map que consulta el router.

const INTERNAL_SECRET = 'test-internal-secret'

let httpServer: HttpServer
let io: Server
let port: number
let client: ClientSocket | undefined

function waitFor<T = unknown>(socket: ClientSocket, event: string, timeout = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout esperando '${event}'`)), timeout)
    socket.once(event, (data: T) => { clearTimeout(t); resolve(data) })
  })
}

async function get(path: string, headers: Record<string, string> = {}, body?: unknown): Promise<Response> {
  const url = `http://localhost:${port}${path}`
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

function connectClient(): Promise<ClientSocket> {
  const c = ioc(`http://localhost:${port}`, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  })
  client = c
  return waitFor(c, 'connect').then(() => c)
}

beforeAll(() => {
  process.env.INTERNAL_PROXY_SECRET = INTERNAL_SECRET

  const app = express()
  app.use(express.json())
  httpServer = createServer(app)
  io = new Server(httpServer, { cors: { origin: '*' } })

  // Montar el router con el io real (comparte el mismo httpServer que el socket)
  app.use('/internal/llm', createInternalLlmRouter(io))

  // Aceptar conexiones de socket
  io.on('connection', () => {})

  return new Promise<void>((resolve) => {
    httpServer.listen(0, () => {
      port = (httpServer.address() as AddressInfo).port
      resolve()
    })
  })
})

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  pendingLlmRequests.clear()
})

afterEach(() => {
  client?.disconnect()
  client = undefined
  vi.restoreAllMocks()
  pendingLlmRequests.clear()
})

afterAll(() => {
  io.close()
  httpServer.close()
  delete process.env.INTERNAL_PROXY_SECRET
})

describe('POST /internal/llm — autenticación interna', () => {
  it('sin X-Internal-Token → 401', async () => {
    const res = await get('/internal/llm', {}, { proxy_session: 'x' })
    expect(res.status).toBe(401)
  })

  it('X-Internal-Token incorrecto → 401', async () => {
    const res = await get('/internal/llm', { 'X-Internal-Token': 'wrong-secret' }, { proxy_session: 'x' })
    expect(res.status).toBe(401)
  })
})

describe('POST /internal/llm — socket no existe', () => {
  it('proxy_session desconocido → 409 browser_disconnected', async () => {
    const res = await get(
      '/internal/llm',
      { 'X-Internal-Token': INTERNAL_SECRET },
      { proxy_session: 'socket-no-existe', model: 'gpt-4o-mini', messages: [] },
    )
    expect(res.status).toBe(409)
    const body = await res.json() as { error_code: string }
    expect(body.error_code).toBe('browser_disconnected')
  })
})

describe('POST /internal/llm — flujo completo', () => {
  it('el navegador responde con llm:response → 200 con content', async () => {
    const c = await connectClient()

    // El navegador escucha llm:request y responde llm:response de forma inmediata
    c.on('llm:request', ({ request_id }: { request_id: string }) => {
      c.emit('llm:response', { request_id, content: 'respuesta del modelo' })
    })

    const res = await get(
      '/internal/llm',
      { 'X-Internal-Token': INTERNAL_SECRET },
      { proxy_session: c.id, model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hola' }] },
    )

    expect(res.status).toBe(200)
    const body = await res.json() as { content: string }
    expect(body.content).toBe('respuesta del modelo')
  }, 8000)

  it('el navegador responde con llm:error → 502 con error_code y detail', async () => {
    const c = await connectClient()

    c.on('llm:request', ({ request_id }: { request_id: string }) => {
      c.emit('llm:error', { request_id, error_code: 'api_error', detail: 'invalid api key' })
    })

    const res = await get(
      '/internal/llm',
      { 'X-Internal-Token': INTERNAL_SECRET },
      { proxy_session: c.id, model: 'gpt-4o-mini', messages: [] },
    )

    expect(res.status).toBe(502)
    const body = await res.json() as { error_code: string; detail: string }
    expect(body.error_code).toBe('api_error')
    expect(body.detail).toBe('invalid api key')
  }, 8000)
})

describe('POST /internal/llm — timeout forzado', () => {
  it('timeout al expirar la promise → 504 timeout', async () => {
    const c = await connectClient()

    // El navegador recibe llm:request pero en vez de responder, forzamos el
    // timeout a mano desde el Map para no esperar 120s en el test.
    c.on('llm:request', ({ request_id }: { request_id: string }) => {
      const entry = pendingLlmRequests.get(request_id)
      if (entry) {
        clearTimeout(entry.timer)
        pendingLlmRequests.delete(request_id)
        entry.reject({ error_code: 'timeout' })
      }
    })

    const res = await get(
      '/internal/llm',
      { 'X-Internal-Token': INTERNAL_SECRET },
      { proxy_session: c.id, model: 'gpt-4o-mini', messages: [] },
    )

    expect(res.status).toBe(504)
    const body = await res.json() as { error_code: string }
    expect(body.error_code).toBe('timeout')
  }, 8000)
})
