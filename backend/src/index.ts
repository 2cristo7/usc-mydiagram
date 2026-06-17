import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { Server } from 'socket.io'
import diagramsRouter from './diagrams'
import llmConfigRouter from './llmConfig'
import accountRouter from './account'
import { attachAgentHandlers, createInternalLlmRouter } from './socketHandlers'

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

// S10.3 — Configuración LLM del usuario (provider, modelo, api_key cifrada).
// Todas las rutas exigen sesión (requireAuth dentro del router).
app.use('/llm-config', llmConfigRouter)

// S10.4 — Derechos RGPD en autoservicio (acceso/portabilidad y supresión).
// Todas las rutas exigen sesión (requireAuth dentro del router).
app.use('/account', accountRouter)

// S10.3 — Proxy LLM browser: el agente Python delega las llamadas a la API LLM
// al navegador del usuario cuando transport="browser". Solo accesible desde
// localhost con INTERNAL_PROXY_SECRET (no exponer en el CORS público).
//
// Env requeridas: INTERNAL_PROXY_SECRET (compartida con el agente Python).
// Env opcional:   AGENT_BASE_URL (por defecto http://localhost:8000).
app.use('/internal/llm', createInternalLlmRouter(io))

// Wiring del socket (handshake auth + entradas del agente + frescura de token).
// La lógica vive en socketHandlers.ts con inyección de dependencias para poder
// testearla de extremo a extremo; aquí se monta con las dependencias reales.
attachAgentHandlers(io)
