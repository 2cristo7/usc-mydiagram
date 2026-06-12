import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { Server } from 'socket.io'
import diagramsRouter from './diagrams'
import { attachAgentHandlers } from './socketHandlers'

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

// Wiring del socket (handshake auth + entradas del agente + frescura de token).
// La lógica vive en socketHandlers.ts con inyección de dependencias para poder
// testearla de extremo a extremo; aquí se monta con las dependencias reales.
attachAgentHandlers(io)
