import type { Server, Socket } from 'socket.io'
import { verifySupabaseToken } from './auth'
import { assertFreshToken, handleAuthRefresh } from './socketAuth'
import { streamAgentToSocket } from './agentStream'
import { checkRateLimit } from './rateLimit'
import { getCached, setCached } from './cache'

// S10.1 — Wiring del socket extraído de index.ts a una función con inyección de
// dependencias, para poder ejercitarlo de extremo a extremo con un cliente real
// (socket.io-client) y un agente mockeado. index.ts queda como composición:
// crea el server, el io y llama a attachAgentHandlers con las dependencias reales.

export interface AgentHandlerDeps {
  streamAgentToSocket: typeof streamAgentToSocket
  checkRateLimit: (key: string) => boolean
  getCached: typeof getCached
  setCached: typeof setCached
  agentBaseUrl: string
}

const defaultDeps: AgentHandlerDeps = {
  streamAgentToSocket,
  checkRateLimit,
  getCached,
  setCached,
  agentBaseUrl: 'http://localhost:8000',
}

// S9.3b — Rate limit por IDENTIDAD: el user_id autenticado (S9.2) o, si la
// conexión es anónima, la IP del socket.
function rateLimitKey(socket: Socket): string {
  const userId = socket.data.userId as string | null
  return userId ?? `ip:${socket.handshake.address}`
}

// S10.2 — Normaliza el tipo preseleccionado a `string | undefined`. El gateway
// NO valida el enum (eso es contrato del agente, que da 422 a un tipo fuera de
// DiagramType → no es lógica de agente en el gateway, §4): solo descarta lo que
// no sea un string no vacío. Un tipo inválido nunca llega a cachearse porque el
// agente lo rechaza antes del `done`.
function normalizeDiagramType(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

// S10.2 — El payload de generación pasó de string pelado a { prompt, diagram_type? }.
// Tolerante con el formato antiguo: un string se interpreta como prompt sin tipo.
function parseGenerationPayload(message: unknown): { prompt: string; diagramType?: string } {
  if (typeof message === 'string') return { prompt: message }
  const obj = (message ?? {}) as { prompt?: unknown; diagram_type?: unknown }
  return {
    prompt: (obj.prompt ?? '').toString(),
    diagramType: normalizeDiagramType(obj.diagram_type),
  }
}

function emitRateLimited(socket: Socket): void {
  socket.emit('diagram:error', {
    error: 'Has alcanzado el límite de generaciones por minuto. Espera un momento e inténtalo de nuevo.',
    category: 'rate_limit',
  })
}

export function attachAgentHandlers(io: Server, deps: Partial<AgentHandlerDeps> = {}): void {
  const { streamAgentToSocket, checkRateLimit, getCached, setCached, agentBaseUrl } = {
    ...defaultDeps,
    ...deps,
  }

  // S9.2 — Autenticación del handshake.
  // Modo "login solo para guardar": una conexión SIN token es válida (anónima).
  // Un token PRESENTE pero inválido es un cliente con sesión rota → se rechaza.
  // S10.1 — además del userId/email, se guarda `tokenExp` (estado de la conexión)
  // para comprobar luego la frescura del token sin re-verificar cripto.
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined
    if (!token) {
      socket.data.userId = null
      return next()
    }
    try {
      const { userId, email, exp } = await verifySupabaseToken(token)
      socket.data.userId = userId
      socket.data.email = email
      socket.data.tokenExp = exp
      next()
    } catch (err) {
      console.warn('Handshake rechazado: token inválido —', (err as Error).message)
      next(new Error('Token inválido'))
    }
  })

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string | null
    console.log(userId ? `Cliente conectado (user ${userId})` : 'Cliente conectado (anónimo)')

    // S10.1 — el cliente refresca su token (supabase-js, evento TOKEN_REFRESHED)
    // y nos lo reenvía: renovamos el exp de la conexión sin recrear el socket.
    socket.on('auth:refresh', (token) => handleAuthRefresh(socket, token))

    // S9.3b — Generación con admisión (rate limit + caché). useCache=false es el
    // camino de REDO: "Regenerar" fuerza una generación saltándose el lookup y
    // SOBRESCRIBE la entrada (upsert).
    // S10.2 — `diagramType` opcional: el tipo preseleccionado en la UI. Entra en
    // la clave de caché (getCached/setCached) y viaja al agente en el body. Si es
    // undefined (automático) la caché usa la clave histórica y el agente clasifica.
    async function runGeneration(prompt: string, useCache: boolean, diagramType?: string) {
      // S10.1 — frescura del token PRIMERO: un socket con token caducado no llega
      // a consumir rate limit ni a correr el agente. Si caducó, ya se desconectó.
      if (!assertFreshToken(socket)) return
      // Rate limit (cuenta esta petición), también en redo (invariante b).
      if (!checkRateLimit(rateLimitKey(socket))) {
        console.log('⛔ rate limit →', rateLimitKey(socket))
        emitRateLimited(socket)
        return
      }

      if (useCache) {
        const cached = await getCached(prompt, diagramType)
        if (cached) {
          console.log('⚡ cache HIT → se sirve sin llamar al agente')
          socket.emit('diagram:done', {
            title: cached.title,
            degraded: false,
            degradations: [],
            refinement_history: [],
            diagram: cached.diagram,
          })
          return
        }
      }

      await streamAgentToSocket(`${agentBaseUrl}/generate/stream`, { prompt, diagram_type: diagramType }, socket, (done) => {
        const nodes = (done.diagram as { nodes?: unknown[] } | null)?.nodes
        if (!done.degraded && Array.isArray(nodes) && nodes.length > 0) {
          setCached(prompt, done.title ?? null, done.diagram, diagramType)
        }
      })
    }

    // Generación: no hay diagrama previo → el agente parte de cero (S7.1).
    // S10.2 — el payload pasó de string pelado a { prompt, diagram_type? }. Se
    // tolera el string antiguo (un cliente sin actualizar manda solo el prompt →
    // tipo automático) para no romper conexiones a medio desplegar.
    socket.on('message:send', async (message) => {
      const { prompt, diagramType } = parseGenerationPayload(message)
      console.log(`Mensaje recibido del cliente (generación): ${prompt}${diagramType ? ` [tipo: ${diagramType}]` : ' [tipo: auto]'}`)
      await runGeneration(prompt, true, diagramType)
    })

    // S9.3b — Redo: regenera el mismo prompt IGNORANDO la caché y sobrescribe.
    // S10.2 — conserva el tipo forzado original (lo reenvía el frontend) para que
    // regenerar no cambie el tipo del diagrama bajo los pies del usuario.
    socket.on('message:regenerate', async (payload) => {
      const prompt = (payload?.prompt ?? '').toString()
      if (!prompt) return
      const diagramType = normalizeDiagramType(payload?.diagram_type)
      console.log(`Mensaje recibido del cliente (regenerar, sin caché): ${prompt}${diagramType ? ` [tipo: ${diagramType}]` : ' [tipo: auto]'}`)
      await runGeneration(prompt, false, diagramType)
    })

    // Refinamiento: el frontend ya decidió que hay diagrama y adjunta su versión
    // compacta. No se cachea (depende del diagrama de entrada, no solo del prompt).
    socket.on('message:refine', async (payload) => {
      const { prompt, diagram } = payload ?? {}
      console.log('Mensaje recibido del cliente (refinamiento):', prompt)
      if (!assertFreshToken(socket)) return
      if (!checkRateLimit(rateLimitKey(socket))) {
        console.log('⛔ rate limit →', rateLimitKey(socket))
        emitRateLimited(socket)
        return
      }
      console.log(`   diagrama adjunto: type=${diagram?.diagram_type ?? 'NULL'} · ${diagram?.nodes?.length ?? 0} nodos · ${diagram?.edges?.length ?? 0} aristas`)
      await streamAgentToSocket(`${agentBaseUrl}/refine/stream`, { prompt, diagram }, socket)
    })

    // Reanudación tras clarificación (S7.4): la respuesta del usuario + el
    // thread_id de la ejecución pausada van a /refine/resume.
    socket.on('message:clarification_answer', async (payload) => {
      const { thread_id, answer } = payload ?? {}
      console.log('Respuesta de clarificación recibida:', answer)
      if (!assertFreshToken(socket)) return
      if (!checkRateLimit(rateLimitKey(socket))) {
        console.log('⛔ rate limit →', rateLimitKey(socket))
        emitRateLimited(socket)
        return
      }
      await streamAgentToSocket(`${agentBaseUrl}/refine/resume`, { thread_id, answer }, socket)
    })

    socket.on('disconnect', () => {
      console.log('Cliente desconectado del WebSocket')
    })
  })
}
