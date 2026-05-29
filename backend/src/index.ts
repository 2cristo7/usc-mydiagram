import express from 'express'
import cors from 'cors'
import jsonwebtoken from 'jsonwebtoken'
import dotenv from 'dotenv'
import { Server } from 'socket.io'
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




// Gestión websocket
io.on('connection', (socket) => {
  console.log('Cliente conectado al WebSocket')

  socket.on('message:send', async (message) =>{
    const prompt = message.toString()
    console.log('Mensaje recibido del cliente:', prompt)

    try {
      const agentRes = await fetch('http://localhost:8000/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      const decoder = new TextDecoder()
      const reader = agentRes.body!.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done){
          socket.emit('diagram:done')
          break
        }
        const chunk = decoder.decode(value)
        socket.emit('diagram:chunk', chunk)
        console.log('Chunk enviado al cliente:', chunk)
      }
    } catch (err) {
      console.error('Error llamando al agente:', err)
      socket.emit('diagram:error', { error: 'Error generando el diagrama' })
    }
  })

  socket.on('disconnect', () => {
    console.log('Cliente desconectado del WebSocket')
  })
})


