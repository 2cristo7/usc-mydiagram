import type { Server, Socket } from 'socket.io'
import { Router, type Response } from 'express'
import { verifySupabaseToken } from './auth'
import { assertFreshToken, handleAuthRefresh } from './socketAuth'
import { streamAgentToSocket, type LlmConfig } from './agentStream'
import { checkRateLimit } from './rateLimit'
import { getCached, setCached } from './cache'
import { supabaseForUser } from './supabase'

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
  // Des-hardcodeado: usa env si está presente, fallback al valor histórico.
  // Env nueva: AGENT_BASE_URL (compartida con el agente; por defecto localhost:8000)
  agentBaseUrl: process.env.AGENT_BASE_URL ?? 'http://localhost:8000',
}

// ── Proxy LLM browser ───────────────────────────────────────────────────────
// El agente Python necesita usar la API key que reside en el NAVEGADOR del
// usuario (transport="browser"). El flujo es:
//   1. Gateway genera un request_id y emite `llm:request` al socket del usuario.
//   2. El navegador llama a la API LLM y devuelve la respuesta vía `llm:response`.
//   3. El gateway resuelve la Promise y devuelve el contenido al agente Python.
//
// Env nueva: INTERNAL_PROXY_SECRET (compartida con el agente Python).
//
// El Map vive aquí (módulo) para ser compartido entre los handlers de socket y
// el router Express createInternalLlmRouter. Se exporta para tests.

interface PendingLlmRequest {
  resolve: (content: string) => void
  reject: (err: { error_code: string; detail?: string }) => void
  timer: ReturnType<typeof setTimeout>
}

export const pendingLlmRequests = new Map<string, PendingLlmRequest>()

// ── Router interno /internal/llm ────────────────────────────────────────────
// El agente Python hace POST a esta ruta con X-Internal-Token para delegar la
// llamada LLM al navegador del usuario (transport="browser").

export function createInternalLlmRouter(io: Server) {
  const router = Router()

  router.post('/', async (req, res: Response) => {
    // 1. Validar token interno
    const secret = process.env.INTERNAL_PROXY_SECRET
    if (!secret || req.headers['x-internal-token'] !== secret) {
      res.status(401).json({ error: 'No autorizado' })
      return
    }

    const { proxy_session, model, messages, options, think } = req.body ?? {}

    if (!proxy_session || typeof proxy_session !== 'string') {
      res.status(400).json({ error: 'Falta proxy_session' })
      return
    }

    // 2. Buscar el socket activo del usuario
    const socket = io.sockets.sockets.get(proxy_session)
    if (!socket) {
      res.status(409).json({ error_code: 'browser_disconnected' })
      return
    }

    // 3. Generar request_id, registrar la Promise, emitir llm:request al navegador.
    //
    // Los listeners `llm:response`/`llm:error` se registran directamente aquí
    // para que el router sea autosuficiente sin necesitar attachAgentHandlers
    // (simplifica los tests). Se captura `sock` para evitar el narrowing de TS.
    const request_id = `llm_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const sock = socket // narrowing: garantiza que no es undefined dentro de la Promise

    const resultPromise = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingLlmRequests.delete(request_id)
        sock.off('llm:response', onResponse)
        sock.off('llm:error', onError)
        reject({ error_code: 'timeout' })
      }, 120_000)

      function onResponse({ request_id: rid, content }: { request_id: string; content: string }) {
        if (rid !== request_id) return
        clearTimeout(timer)
        pendingLlmRequests.delete(request_id)
        sock.off('llm:response', onResponse)
        sock.off('llm:error', onError)
        resolve(content)
      }

      function onError({ request_id: rid, error_code, detail }: { request_id: string; error_code: string; detail?: string }) {
        if (rid !== request_id) return
        clearTimeout(timer)
        pendingLlmRequests.delete(request_id)
        sock.off('llm:response', onResponse)
        sock.off('llm:error', onError)
        reject({ error_code, detail })
      }

      pendingLlmRequests.set(request_id, {
        resolve: (content) => onResponse({ request_id, content }),
        reject: (err) => onError({ request_id, ...err }),
        timer,
      })

      sock.on('llm:response', onResponse)
      sock.on('llm:error', onError)
    })

    sock.emit('llm:request', { request_id, model, messages, options, think })

    try {
      const content = await resultPromise
      res.status(200).json({ content })
    } catch (err) {
      const e = err as { error_code: string; detail?: string }
      if (e.error_code === 'timeout') {
        res.status(504).json({ error_code: 'timeout' })
      } else {
        res.status(502).json({ error_code: e.error_code ?? 'browser_error', detail: e.detail })
      }
    }
  })

  return router
}

// ── Lectura de config LLM del usuario ───────────────────────────────────────
// Lee la fila del usuario en Supabase (RPC SECURITY DEFINER get_llm_config y
// get_llm_api_key) y monta el objeto LlmConfig a inyectar en el body del agente.
// Devuelve undefined si el socket es anónimo o si no hay fila de config.

async function resolveLlmConfig(socket: Socket): Promise<LlmConfig | undefined> {
  const userId = socket.data.userId as string | null
  const token = socket.handshake.auth?.token as string | undefined
  if (!userId || !token) return undefined

  try {
    const supabase = supabaseForUser(token)
    const { data: rows, error } = await supabase.rpc('get_llm_config')
    if (error || !rows) return undefined

    const row = Array.isArray(rows) ? rows[0] : rows
    if (!row) return undefined

    const { provider, transport, model_fast, model_capable, base_url, saved_providers } = row

    // Resolución de la API key, en dos modos:
    //  1) Persistida (S10.3b/c): si el proveedor activo está en saved_providers,
    //     se descifra su key de Vault server-side.
    //  2) Transitoria (modo por defecto): el navegador empujó la key por
    //     `llm:set_transient_key` y vive solo en memoria del socket. Se usa si no
    //     hay key persistida y el proveedor coincide con el de la config.
    // La persistida tiene prioridad: si el usuario consintió, esa es la verdad.
    const hasPersistedKey = Array.isArray(saved_providers) && saved_providers.includes(provider)
    let api_key: string | null = null
    if (hasPersistedKey) {
      const { data: key } = await supabase.rpc('get_llm_api_key', { p_provider: provider })
      api_key = key ?? null
    } else {
      const transient = socket.data.transientApiKey as { provider: string; key: string } | undefined
      if (transient && transient.provider === provider) {
        api_key = transient.key
      }
    }

    const config: LlmConfig = {
      provider,
      transport,
      model_fast,
      model_capable,
      base_url: base_url ?? null,
      api_key,
      // Para transport="browser" el agente hará POST /internal/llm con este session id
      proxy_session: transport === 'browser' ? socket.id : null,
    }
    return config
  } catch (err) {
    console.warn('No se pudo leer la config LLM del usuario, usando defaults del agente —', (err as Error).message)
    return undefined
  }
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

    // S10.3b — Key transitoria: en el modo por defecto la API key NO se persiste
    // (vive en sessionStorage del navegador). El cliente la empuja aquí al
    // conectar y al cambiarla; la guardamos SOLO en memoria del socket para
    // inyectarla en la generación (resolveLlmConfig). Nunca toca BD ni disco.
    // payload null → el usuario la borró/persistió: se olvida de inmediato.
    socket.on('llm:set_transient_key', (payload) => {
      if (payload && typeof payload.provider === 'string' && typeof payload.api_key === 'string' && payload.api_key) {
        socket.data.transientApiKey = { provider: payload.provider, key: payload.api_key }
      } else {
        delete socket.data.transientApiKey
      }
    })

    // Al desconectar, rechazar todas las Promises pendientes de este socket para
    // no dejar /internal/llm colgado esperando los 120s. Los listeners
    // llm:response/llm:error los registra createInternalLlmRouter directamente
    // en el socket (socket.on) y los limpia al resolverse; aquí solo hacemos
    // cleanup de emergencia para el caso de desconexión inesperada.
    socket.on('disconnect', () => {
      console.log('Cliente desconectado del WebSocket')
      for (const [request_id, pending] of pendingLlmRequests) {
        pendingLlmRequests.delete(request_id)
        clearTimeout(pending.timer)
        pending.reject({ error_code: 'browser_disconnected' })
      }
    })

    // S9.3b — Generación con admisión (rate limit + caché). useCache=false es el
    // camino de REDO: "Regenerar" fuerza una generación saltándose el lookup y
    // SOBRESCRIBE la entrada (upsert).
    // S10.2 — `diagramType` opcional: el tipo preseleccionado en la UI. Entra en
    // la clave de caché (getCached/setCached) y viaja al agente en el body. Si es
    // undefined (automático) la caché usa la clave histórica y el agente clasifica.
    // S10.3 — `llmConfig`: configuración LLM del usuario leída de Supabase antes
    // de llamar al agente. Se omite si el socket es anónimo o no hay fila.
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

      // S10.3 — leer config LLM del usuario (async, no bloquea la generación si falla)
      const llmConfig = await resolveLlmConfig(socket)

      await streamAgentToSocket(`${agentBaseUrl}/generate/stream`, { prompt, diagram_type: diagramType }, socket, (done) => {
        const nodes = (done.diagram as { nodes?: unknown[] } | null)?.nodes
        if (!done.degraded && Array.isArray(nodes) && nodes.length > 0) {
          setCached(prompt, done.title ?? null, done.diagram, diagramType)
        }
      }, llmConfig)
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

      // S10.3 — config LLM también para refinamiento
      const llmConfig = await resolveLlmConfig(socket)
      await streamAgentToSocket(`${agentBaseUrl}/refine/stream`, { prompt, diagram }, socket, undefined, llmConfig)
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
      // S10.3 — config LLM también para reanudación de clarificación
      const llmConfig = await resolveLlmConfig(socket)
      await streamAgentToSocket(`${agentBaseUrl}/refine/resume`, { thread_id, answer }, socket, undefined, llmConfig)
    })
  })
}
