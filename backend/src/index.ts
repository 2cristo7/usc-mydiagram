import express from 'express'
import cors from 'cors'

const app = express()
const PORT = process.env.PORT || 3001

// Middlewares
app.use(cors())
app.use(express.json())

// Ruta de salud
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'backend' })
})

app.listen(PORT, () => {
  console.log(`Backend corriendo en http://localhost:${PORT}`)
})
