import express from 'express'
import cors from 'cors'
import jsonwebtoken from 'jsonwebtoken'
import dotenv from 'dotenv'
import { Server, Socket } from 'socket.io'
import Stream from 'node:stream'

// Cargar variables de entorno
dotenv.config()

interface AuthRequest extends express.Request {
  user?: any
}

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


function authenticateToken(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) return res.status(401).json({ error: 'Token no proporcionado' })

  jsonwebtoken.verify(token, process.env.JWT_SECRET as string, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    (req as AuthRequest).user = user
    next()
  })
}

// Ruta de salud
app.get('/health', (req, res) => {
  console.log('Ruta de salud accedida')
  res.json({ status: 'ok', service: 'backend' })
})

app.post('/api/diagram/generate', authenticateToken, (req, res) => {
  const { body } = req.body
  // Aquí iría la lógica para generar el diagrama a partir de la descripción
  // Por ahora, solo devolvemos un mensaje de éxito
  res.json({ message: 'Diagrama generado con éxito:', receivedBody: body})
})

app.get('/api/diagrams', authenticateToken, (req, res) => {
  // Aquí iría la lógica para obtener los diagramas guardados del usuario
  // Por ahora, solo devolvemos un mensaje de éxito
  res.json({
    diagrams: [
      { id: 1, title: 'Diagrama 1', nodes: ["Nodo 1"], edges: ["Arista 1"] },
      { id: 2, title: 'Diagrama 2', nodes: ["Nodo 2"], edges: ["Arista 2"] }
    ]
  })
})




// Reenvía la petición al agente Python y re-emite su stream NDJSON por Socket.io.
// El gateway solo enruta: no interpreta la lógica del agente (antipatrón de la
// visión global). Compartido por generación y refinamiento (S7.1): ambos hablan
// el mismo protocolo NDJSON, solo cambian la URL del agente y el cuerpo.
async function streamAgentToSocket(url: string, body: object, socket: Socket) {
  try {
    const agentRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const decoder = new TextDecoder()
    const reader = agentRes.body!.getReader()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const item = JSON.parse(line)
          switch (item._type) {
            case 'node':
              socket.emit('diagram:node_ready', item.data)
              break
            case 'edge':
              socket.emit('diagram:edge_ready', item.data)
              break
            case 'done':
              // Propaga la bandera de degradación y los motivos por categoría
              // (S6.9); el frontend compone el aviso. degraded=false → done limpio.
              // refinement_history (S7.4): traza de tool calls de un refinamiento;
              // vacío en generación.
              socket.emit('diagram:done', {
                title: item.title,
                degraded: item.degraded ?? false,
                degradations: item.degradations ?? [],
                refinement_history: item.refinement_history ?? [],
              })
              break
            case 'clarification':
              // S7.4 — el agente pausó en ask_clarification: pregunta + opciones
              // (botones) + thread_id, que el frontend debe devolver con la
              // respuesta para reanudar ESA ejecución.
              socket.emit('agent:clarification', {
                thread_id: item.thread_id,
                question: item.question,
                options: item.options ?? [],
              })
              break
            case 'error':
              // Propaga la categoría del fallo además del mensaje accionable.
              socket.emit('diagram:error', { error: item.message, category: item.category })
              break
            default:
              console.warn('Tipo de evento NDJSON desconocido:', item._type)
          }
        } catch {
          console.warn('Línea NDJSON inválida ignorada:', line)
        }
      }
    }
  } catch (err) {
    console.error('Error llamando al agente:', err)
    socket.emit('diagram:error', { error: 'Error generando el diagrama' })
  }
}

// Gestión websocket
io.on('connection', (socket) => {
  console.log('Cliente conectado al WebSocket')

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


