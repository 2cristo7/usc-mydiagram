import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { Server } from 'socket.io'
import { streamAgentToSocket } from './agentStream'
import { verifySupabaseToken } from './auth'
import diagramsRouter from './diagrams'

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

// Gestión websocket
io.on('connection', (socket) => {
  const userId = socket.data.userId as string | null
  console.log(userId ? `Cliente conectado (user ${userId})` : 'Cliente conectado (anónimo)')

  // Generación: no hay diagrama previo → el agente parte de cero (S7.1).
  socket.on('message:send', async (message) => {
    const prompt = message.toString()
    console.log('Mensaje recibido del cliente (generación):', prompt)
    await streamAgentToSocket('http://localhost:8000/generate/stream', { prompt }, socket)
  })

  // Refinamiento: el frontend ya decidió que hay diagrama y adjunta su versión
  // compacta. El gateway solo reenvía {prompt, diagram} al pipeline de refinado.
  socket.on('message:refine', async (payload) => {
    const { prompt, diagram } = payload ?? {}
    console.log('Mensaje recibido del cliente (refinamiento):', prompt)
    console.log(`   diagrama adjunto: type=${diagram?.diagram_type ?? 'NULL'} · ${diagram?.nodes?.length ?? 0} nodos · ${diagram?.edges?.length ?? 0} aristas`)
    await streamAgentToSocket('http://localhost:8000/refine/stream', { prompt, diagram }, socket)
  })

  // Reanudación tras clarificación (S7.4): la respuesta del usuario + el
  // thread_id de la ejecución pausada van a /refine/resume, que continúa el
  // mismo protocolo NDJSON (puede acabar en done, error u otra clarification).
  socket.on('message:clarification_answer', async (payload) => {
    const { thread_id, answer } = payload ?? {}
    console.log('Respuesta de clarificación recibida:', answer)
    await streamAgentToSocket('http://localhost:8000/refine/resume', { thread_id, answer }, socket)
  })

  socket.on('disconnect', () => {
    console.log('Cliente desconectado del WebSocket')
  })
})
