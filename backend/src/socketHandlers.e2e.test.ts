import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest'
import { createServer, type Server as HttpServer } from 'http'
import type { AddressInfo } from 'net'
import { Server } from 'socket.io'
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client'

// S10.1 — E2E del socket de extremo a extremo: cliente socket.io-client REAL
// contra un io levantado, con el agente y la admisión inyectados como mocks. Se
// ejercita el wiring completo (handshake → guard de frescura → auth:refresh) tal
// como corre en producción, sin depender del microservicio Python.
//
// La verificación del JWT se mockea para controlar el (userId, exp) por token
// sin firmar tokens reales: 'expired' simula un token que conectó válido y luego
// caducó (exp en el pasado); 'fresh' un token vigente; 'attacker' otro usuario.

vi.mock('./auth', () => ({ verifySupabaseToken: vi.fn() }))
import { verifySupabaseToken } from './auth'
import { attachAgentHandlers } from './socketHandlers'

const mockVerify = vi.mocked(verifySupabaseToken)

const now = () => Math.floor(Date.now() / 1000)

let httpServer: HttpServer
let io: Server
let port: number
let client: ClientSocket | undefined

// Mock del agente: emite un done sintético en vez de llamar a la red.
// El socket es el 3er argumento. La guarda defensiva ignora invocaciones sin
// socket: si el cuerpo del mock lanzara (socket undefined), la rejection no
// manejada del handler async de socket.io reentra y contamina el resto de tests.
const streamMock = vi.fn(async (_url: string, _body: unknown, socket?: { emit: (e: string, p: unknown) => void }) => {
  if (!socket) return
  socket.emit('diagram:done', { title: 't', degraded: false, degradations: [], refinement_history: [], diagram: { nodes: [{}], edges: [] } })
})

function waitFor<T = unknown>(socket: ClientSocket, event: string, timeout = 2500): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout esperando '${event}'`)), timeout)
    socket.once(event, (data: T) => { clearTimeout(timer); resolve(data) })
  })
}

function connect(token: string): Promise<ClientSocket> {
  const c = ioc(`http://localhost:${port}`, { transports: ['websocket'], auth: { token }, forceNew: true, reconnection: false })
  client = c
  return waitFor(c, 'connect').then(() => c)
}

beforeAll(() => {
  mockVerify.mockImplementation(async (token: string) => {
    if (token === 'expired') return { userId: 'u1', exp: now() - 100 }
    if (token === 'fresh') return { userId: 'u1', exp: now() + 3600 }
    if (token === 'attacker') return { userId: 'attacker', exp: now() + 3600 }
    throw new Error('token desconocido')
  })

  httpServer = createServer()
  io = new Server(httpServer, { cors: { origin: '*' } })
  attachAgentHandlers(io, {
    streamAgentToSocket: streamMock as never,
    checkRateLimit: () => true,
    getCached: (async () => null) as never,
    setCached: (() => {}) as never,
    agentBaseUrl: 'http://agent.invalid',
  })

  return new Promise<void>((resolve) => {
    httpServer.listen(0, () => {
      port = (httpServer.address() as AddressInfo).port
      resolve()
    })
  })
})

beforeEach(() => streamMock.mockClear())
afterEach(() => { client?.disconnect(); client = undefined })
afterAll(() => { io.close(); httpServer.close() })

describe('socket auth E2E (frescura de token)', () => {
  it('token caducado en socket vivo → message:send recibe auth:expired y se desconecta', async () => {
    const c = await connect('expired')
    const disconnected = waitFor(c, 'disconnect')
    const expired = waitFor(c, 'auth:expired')
    c.emit('message:send', 'haz un ERD')
    await expired
    await disconnected // el backend cortó la conexión
    expect(streamMock).not.toHaveBeenCalled() // no llegó a correr el agente
  })

  it('token fresco → message:send corre el agente y NO expira', async () => {
    const c = await connect('fresh')
    let expired = false
    c.on('auth:expired', () => { expired = true })
    c.emit('message:send', 'haz un ERD')
    await waitFor(c, 'diagram:done')
    expect(streamMock).toHaveBeenCalledOnce()
    expect(expired).toBe(false)
    expect(c.connected).toBe(true)
  })

  it('auth:refresh con identidad distinta → corta la conexión', async () => {
    const c = await connect('fresh')
    const expired = waitFor(c, 'auth:expired')
    const disconnected = waitFor(c, 'disconnect')
    c.emit('auth:refresh', 'attacker')
    await expired
    await disconnected
  })

  it('auth:refresh con token inválido (verify lanza) → corta la conexión', async () => {
    const c = await connect('fresh')
    const expired = waitFor(c, 'auth:expired')
    const disconnected = waitFor(c, 'disconnect')
    c.emit('auth:refresh', 'desconocido') // el mock de verify lanza para este token
    await expired
    await disconnected
  })

  it('auth:refresh del mismo usuario → mantiene viva la conexión', async () => {
    const c = await connect('fresh')
    let expired = false
    c.on('auth:expired', () => { expired = true })
    c.emit('auth:refresh', 'fresh')
    // tras el refresh, una operación sigue funcionando (no se cortó)
    c.emit('message:send', 'haz un ERD')
    await waitFor(c, 'diagram:done')
    expect(expired).toBe(false)
    expect(c.connected).toBe(true)
  })
})
