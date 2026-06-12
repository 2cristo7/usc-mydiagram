import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { Server } from 'socket.io'
import { streamAgentToSocket } from './agentStream'
import { verifySupabaseToken } from './auth'
import diagramsRouter from './diagrams'
import { checkRateLimit } from './rateLimit'
import { getCached, setCached } from './cache'
import type { Socket } from 'socket.io'

// Cargar variables de entorno
dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001
const server = app.listen(PORT, () => {
  console.log(`Backend corriendo en http://localhost:${PORT}`)
})
const io = new Server(server, { cors: { origin: '*' } })

// Middlewares
app.use(cors())
app.use(express.json())
app.use((req, res, next) => {
  console.log(`📨 [${new Date().toISOString()}] ${req.method} ${req.path}`)
  next()
})

// Ruta de salud
app.get('/health', (req, res) => {
  console.log('Ruta de salud accedida')
  res.json({ status: 'ok', service: 'backend' })
})

// S9.3 — Persistencia de diagramas (CRUD). Todas las rutas exigen sesión
// (requireAuth dentro del router): "login solo para guardar".
app.use('/diagrams', diagramsRouter)

// S9.2 — Autenticación del handshake de Socket.io.
// Modo "login solo para guardar": la generación funciona sin sesión, así que una
// conexión SIN token es válida (anónima). Un token PRESENTE pero inválido no es
// anonimato — es un cliente con sesión rota — y se rechaza para forzar refresco.
// `socket.data.userId` queda disponible para las operaciones que sí requieren
// usuario (persistencia, historial — S9.3).
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token as string | undefined
  if (!token) {
    socket.data.userId = null
    return next()
  }
  try {
    const { userId, email } = await verifySupabaseToken(token)
    socket.data.userId = userId
    socket.data.email = email
    next()
  } catch (err) {
    console.warn('Handshake rechazado: token inválido —', (err as Error).message)
    next(new Error('Token inválido'))
  }
})

// S9.3b — Rate limit por IDENTIDAD: el user_id autenticado (S9.2) o, si la
// conexión es anónima, la IP del socket. Una sola petición = una llamada a
// checkRateLimit, ANTES de mirar la caché (invariante b).
function rateLimitKey(socket: Socket): string {
  const userId = socket.data.userId as string | null
  return userId ?? `ip:${socket.handshake.address}`
}

function emitRateLimited(socket: Socket): void {
  socket.emit('diagram:error', {
    error: 'Has alcanzado el límite de generaciones por minuto. Espera un momento e inténtalo de nuevo.',
    category: 'rate_limit',
  })
}

// Gestión websocket
io.on('connection', (socket) => {
  const userId = socket.data.userId as string | null
  console.log(userId ? `Cliente conectado (user ${userId})` : 'Cliente conectado (anónimo)')

  // S9.3b — Generación con admisión (rate limit + caché). useCache=false es el
  // camino de REDO (decisión P3 del usuario): el botón "Regenerar" fuerza una
  // generación nueva saltándose el lookup y SOBRESCRIBE la entrada (upsert), de
  // modo que la caché siempre devuelve el último resultado para ese prompt. Sin
  // este camino, un prompt cacheado nunca podría regenerarse.
  async function runGeneration(prompt: string, useCache: boolean) {
    // Rate limit PRIMERO (cuenta esta petición), también en redo: un hit o un
    // redo no evaden el límite (invariante b).
    if (!checkRateLimit(rateLimitKey(socket))) {
      console.log('⛔ rate limit →', rateLimitKey(socket))
      emitRateLimited(socket)
      return
    }

    if (useCache) {
      const cached = await getCached(prompt)
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

    // Miss o redo: genera y, si el resultado es un éxito LIMPIO (≥1 nodo, no
    // degradado), lo cachea/sobrescribe para la próxima vez (onDone).
    await streamAgentToSocket('http://localhost:8000/generate/stream', { prompt }, socket, (done) => {
      const nodes = (done.diagram as { nodes?: unknown[] } | null)?.nodes
      if (!done.degraded && Array.isArray(nodes) && nodes.length > 0) {
        setCached(prompt, done.title ?? null, done.diagram)
      }
    })
  }

  // Generación: no hay diagrama previo → el agente parte de cero (S7.1).
  socket.on('message:send', async (message) => {
    const prompt = message.toString()
    console.log('Mensaje recibido del cliente (generación):', prompt)
    await runGeneration(prompt, true)
  })

  // S9.3b — Redo: regenera el mismo prompt IGNORANDO la caché y sobrescribe.
  socket.on('message:regenerate', async (payload) => {
    const prompt = (payload?.prompt ?? '').toString()
    if (!prompt) return
    console.log('Mensaje recibido del cliente (regenerar, sin caché):', prompt)
    await runGeneration(prompt, false)
  })

  // Refinamiento: el frontend ya decidió que hay diagrama y adjunta su versión
  // compacta. El backend solo reenvía {prompt, diagram} al pipeline de refinado.
  // No se cachea (depende del diagrama de entrada, no solo del prompt).
  socket.on('message:refine', async (payload) => {
    const { prompt, diagram } = payload ?? {}
    console.log('Mensaje recibido del cliente (refinamiento):', prompt)
    if (!checkRateLimit(rateLimitKey(socket))) {
      console.log('⛔ rate limit →', rateLimitKey(socket))
      emitRateLimited(socket)
      return
    }
    console.log(`   diagrama adjunto: type=${diagram?.diagram_type ?? 'NULL'} · ${diagram?.nodes?.length ?? 0} nodos · ${diagram?.edges?.length ?? 0} aristas`)
    await streamAgentToSocket('http://localhost:8000/refine/stream', { prompt, diagram }, socket)
  })

  // Reanudación tras clarificación (S7.4): la respuesta del usuario + el
  // thread_id de la ejecución pausada van a /refine/resume, que continúa el
  // mismo protocolo NDJSON (puede acabar en done, error u otra clarification).
  socket.on('message:clarification_answer', async (payload) => {
    const { thread_id, answer } = payload ?? {}
    console.log('Respuesta de clarificación recibida:', answer)
    if (!checkRateLimit(rateLimitKey(socket))) {
      console.log('⛔ rate limit →', rateLimitKey(socket))
      emitRateLimited(socket)
      return
    }
    await streamAgentToSocket('http://localhost:8000/refine/resume', { thread_id, answer }, socket)
  })

  socket.on('disconnect', () => {
    console.log('Cliente desconectado del WebSocket')
  })
})
