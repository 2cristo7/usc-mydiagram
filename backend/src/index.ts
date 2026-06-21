import express, { type NextFunction, type Request, type Response } from 'express'
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
// S10.5 — error del servidor HTTP: el caso típico es el puerto ya ocupado
// (EADDRINUSE). Se loguea con contexto claro en vez de dejar un crash opaco.
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[server] El puerto ${PORT} ya está en uso. ¿Hay otra instancia del backend corriendo?`)
  } else {
    console.error('[server] Error del servidor HTTP:', err)
  }
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

// S10.5 — Red de seguridad global de Express. Va DESPUÉS de montar todos los
// routers: Express recorre el stack en orden, así que estos dos middlewares solo
// se alcanzan cuando ninguna ruta anterior respondió.

// Catch-all 404: cualquier método/ruta no atendida arriba devuelve JSON, no el
// HTML por defecto de Express (consistente con el resto de respuestas de error).
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Ruta no encontrada.' })
})

// Error-handling middleware (firma de 4 args: Express lo reconoce como tal).
// Captura cualquier error lanzado/propagado por los handlers (incluido un JSON
// malformado que rechace express.json()). Loguea el error real server-side y
// responde un genérico para no filtrar internos al cliente.
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  console.error('[express] error no controlado:', err)
  if (res.headersSent) return
  res.status(500).json({ error: 'Error interno del servidor.' })
})

// S10.5 — Salvaguardas a nivel de proceso. Una promesa rechazada sin .catch() o
// una excepción no capturada no deben tumbar el proceso de forma silenciosa: se
// loguean con contexto. No se hace shutdown agresivo (el server sigue sirviendo
// las conexiones sanas); el objetivo es dejar rastro para diagnosticar.
process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandledRejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[process] uncaughtException:', err)
})
