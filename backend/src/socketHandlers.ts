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
  // S10.5 — socket.id del navegador dueño de esta petición (== proxy_session).
  // El handler de disconnect lo usa para rechazar SOLO los pending de ese socket
  // y no abortar generaciones en vuelo de otros usuarios.
  socketId: string
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
        socketId: proxy_session,
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

// Proveedores que requieren API key (a diferencia de 'ollama', local/sin key).
// Se duplica aquí a propósito: llmConfig.ts lo tiene como const no exportada y no
// queremos acoplar el router HTTP con el handler de socket por una lista de 3
// strings. Si crece, conviene extraerla a un módulo compartido.
const COMMERCIAL_PROVIDERS = ['openai', 'anthropic', 'gemini']

// Campos de la config LLM que el navegador empuja en modo sin login.
interface LocalLlmConfig {
  provider: string
  transport: string
  model_fast: string
  model_capable: string
  base_url?: string | null
}

async function resolveLlmConfig(socket: Socket): Promise<LlmConfig | undefined> {
  const userId = socket.data.userId as string | null

  // Modo sin login: no hay fila en BD. La config (proveedor/transporte/modelos) la
  // posee el navegador y la empujó por `llm:set_local_config`; la API key, si la
  // hay, llega por la vía transitoria (`llm:set_transient_key`), igual que para un
  // usuario con sesión. Sin config local empujada → undefined (defaults del agente).
  if (!userId) {
    const local = socket.data.localLlmConfig as LocalLlmConfig | undefined
    if (!local) return undefined
    let api_key: string | null = null
    if (COMMERCIAL_PROVIDERS.includes(local.provider)) {
      const transient = socket.data.transientApiKey as { provider: string; key: string } | undefined
      if (transient && transient.provider === local.provider) api_key = transient.key
    }
    return {
      provider: local.provider,
      transport: local.transport,
      model_fast: local.model_fast,
      model_capable: local.model_capable,
      base_url: local.base_url ?? null,
      api_key,
      proxy_session: local.transport === 'browser' ? socket.id : null,
    }
  }

  const token = socket.handshake.auth?.token as string | undefined
  if (!token) return undefined

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
      // S10.3c — la key persistida vive cifrada en Vault. Si este RPC falla de
      // forma transitoria (hipo de red/DB) y descartamos el error, `api_key`
      // queda null y el agente recibe un Bearer vacío → HTTP 401 INTERMITENTE
      // que «luego vuelve a funcionar» en cuanto el RPC responde bien. Por eso
      // lo registramos en vez de tragarlo.
      const { data: key, error: keyErr } = await supabase.rpc('get_llm_api_key', { p_provider: provider })
      if (keyErr) {
        console.warn(`[llm-config] get_llm_api_key falló para provider=${provider}:`, keyErr.message)
      }
      api_key = key ?? null
    } else {
      const transient = socket.data.transientApiKey as { provider: string; key: string } | undefined
      if (transient && transient.provider === provider) {
        api_key = transient.key
      }
    }

    // Diagnóstico del 401 intermitente: un proveedor comercial que acaba sin key
    // hará que el agente devuelva HTTP 401. Distingue las dos causas reales:
    //  · persisted=true  → el RPC de Vault no devolvió la key (ver warning arriba).
    //  · persisted=false → la key transitoria aún no llegó al socket (race de
    //    reconexión: el navegador la reempuja en `connect`, pero esta generación
    //    salió antes de que el gateway la registrara).
    if (COMMERCIAL_PROVIDERS.includes(provider) && !api_key) {
      console.warn(
        `[llm-config] provider=${provider} resuelto SIN api_key ` +
        `(persisted=${hasPersistedKey}, transient=${Boolean(socket.data.transientApiKey)}) ` +
        `— el agente devolverá HTTP 401.`,
      )
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

// S10.5 — Red de seguridad para los handlers async de socket. streamAgentToSocket
// tiene su propio try/catch, pero un throw síncrono previo (p.ej. en
// parseGenerationPayload) quedaría como unhandledRejection y dejaría al cliente
// colgado sin diagram:error. Este wrapper captura cualquier fallo, lo loguea
// server-side (con el evento como contexto) y emite un error genérico al socket.
function safeHandler(
  socket: Socket,
  event: string,
  handler: (payload: unknown) => Promise<void>,
): (payload: unknown) => void {
  return (payload: unknown) => {
    handler(payload).catch((err) => {
      console.error(`[socket] error no controlado en '${event}':`, err)
      socket.emit('diagram:error', {
        error: 'Error procesando la petición. Vuelve a intentarlo.',
        category: 'internal',
      })
    })
  }
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
    //
    // El segundo argumento es un ACK opcional de Socket.IO. El navegador reenvía
    // la key (con callback) JUSTO antes de cada generación y ESPERA esta
    // confirmación antes de emitirla: así el gateway ya la tiene registrada en
    // memoria cuando resolveLlmConfig la lee, cerrando la carrera
    // reconexión↔generación que dejaba api_key=null → 401 espurio («se arreglaba
    // al recargar»). Los empujes sin callback (re-push de `connect`, push del
    // modal) no acaban aquí: `ack` llega como undefined y se ignora.
    socket.on('llm:set_transient_key', (payload, ack) => {
      if (payload && typeof payload.provider === 'string' && typeof payload.api_key === 'string' && payload.api_key) {
        socket.data.transientApiKey = { provider: payload.provider, key: payload.api_key }
      } else {
        delete socket.data.transientApiKey
      }
      if (typeof ack === 'function') ack({ ok: true })
    })

    // Config LLM completa del modo sin login: una conexión anónima no tiene fila en
    // BD, así que el navegador (única fuente de verdad) empuja aquí proveedor,
    // transporte, modelos y base_url. Se guarda SOLO en memoria del socket y solo la
    // usa resolveLlmConfig cuando la conexión es anónima (con sesión manda la BD).
    // El ACK cierra la carrera reconexión↔generación igual que la key transitoria.
    socket.on('llm:set_local_config', (payload, ack) => {
      if (
        payload &&
        typeof payload.provider === 'string' &&
        typeof payload.transport === 'string' &&
        typeof payload.model_fast === 'string' &&
        typeof payload.model_capable === 'string'
      ) {
        socket.data.localLlmConfig = {
          provider: payload.provider,
          transport: payload.transport,
          model_fast: payload.model_fast,
          model_capable: payload.model_capable,
          base_url: typeof payload.base_url === 'string' ? payload.base_url : null,
        }
      } else {
        delete socket.data.localLlmConfig
      }
      if (typeof ack === 'function') ack({ ok: true })
    })

    // Al desconectar, rechazar las Promises pendientes DE ESTE socket para no
    // dejar /internal/llm colgado esperando los 120s. Los listeners
    // llm:response/llm:error los registra createInternalLlmRouter directamente
    // en el socket (socket.on) y los limpia al resolverse; aquí solo hacemos
    // cleanup de emergencia para el caso de desconexión inesperada.
    // S10.5 — el Map es GLOBAL (compartido entre todos los sockets), así que se
    // filtra por socketId === socket.id: desconectar al usuario A no debe abortar
    // las generaciones en vuelo del usuario B.
    socket.on('disconnect', (reason) => {
      console.log(`Cliente desconectado del WebSocket — ${reason}`)
      for (const [request_id, pending] of pendingLlmRequests) {
        if (pending.socketId !== socket.id) continue
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
    socket.on('message:send', safeHandler(socket, 'message:send', async (message) => {
      const { prompt, diagramType } = parseGenerationPayload(message)
      console.log(`Mensaje recibido del cliente (generación): ${prompt}${diagramType ? ` [tipo: ${diagramType}]` : ' [tipo: auto]'}`)
      await runGeneration(prompt, true, diagramType)
    }))

    // S9.3b — Redo: regenera el mismo prompt IGNORANDO la caché y sobrescribe.
    // S10.2 — conserva el tipo forzado original (lo reenvía el frontend) para que
    // regenerar no cambie el tipo del diagrama bajo los pies del usuario.
    socket.on('message:regenerate', safeHandler(socket, 'message:regenerate', async (raw) => {
      const payload = raw as { prompt?: unknown; diagram_type?: unknown } | undefined
      const prompt = (payload?.prompt ?? '').toString()
      if (!prompt) return
      const diagramType = normalizeDiagramType(payload?.diagram_type)
      console.log(`Mensaje recibido del cliente (regenerar, sin caché): ${prompt}${diagramType ? ` [tipo: ${diagramType}]` : ' [tipo: auto]'}`)
      await runGeneration(prompt, false, diagramType)
    }))

    // Refinamiento: el frontend ya decidió que hay diagrama y adjunta su versión
    // compacta. No se cachea (depende del diagrama de entrada, no solo del prompt).
    socket.on('message:refine', safeHandler(socket, 'message:refine', async (raw) => {
      const { prompt, diagram } = (raw ?? {}) as { prompt?: string; diagram?: { diagram_type?: string; nodes?: unknown[]; edges?: unknown[] } }
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
    }))

    // Reanudación tras clarificación (S7.4): la respuesta del usuario + el
    // thread_id de la ejecución pausada van a /refine/resume.
    socket.on('message:clarification_answer', safeHandler(socket, 'message:clarification_answer', async (raw) => {
      const { thread_id, answer } = (raw ?? {}) as { thread_id?: string; answer?: string }
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
    }))
  })
}
