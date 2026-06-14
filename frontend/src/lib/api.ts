import { useStore } from '../store/index'
import { useAuthStore } from '../store/auth'
import type { DiagramSchema, Message } from '../types'

// S9.3 — Cliente REST de persistencia. El frontend NUNCA habla con Supabase
// directamente (decisión P1): toda la persistencia pasa por el gateway, que es
// el único punto de acceso a datos. Aquí solo se adjunta el Bearer de la sesión;
// la RLS la impone Supabase del otro lado del gateway.

const API_URL = 'http://localhost:3001'

// Metadata del historial (P5): lo que devuelve GET /diagrams, sin el `data`.
export interface DiagramMeta {
  id: string
  title: string
  diagram_type: string
  created_at: string
  updated_at: string
}

// Mensaje tal como vuelve de la BD: el timestamp viaja serializado (string ISO),
// no como Date. Se revive a Date al cargar (ChatMessage llama a toLocaleTimeString).
export type StoredMessage = Omit<Message, 'timestamp'> & { timestamp: string }

// Fila completa: metadata + data (el diagrama para cargar al canvas) + el prompt
// de origen (S9.3b: permite regenerar un diagrama cargado del historial) + la
// conversación persistida (jsonb messages).
export interface DiagramRow extends DiagramMeta {
  data: DiagramSchema
  prompt: string | null
  messages: StoredMessage[]
}

export interface SaveResult {
  ok: boolean
  id?: string
  error?: string
}

function authHeaders(): Record<string, string> | null {
  const token = useAuthStore.getState().session?.access_token
  if (!token) return null
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

async function doSave(prompt?: string): Promise<SaveResult> {
  const headers = authHeaders()
  if (!headers) return { ok: false, error: 'no-session' }

  // Lectura FRESCA del store: al estar serializado, un guardado encadenado ve
  // ya el id que fijó el anterior → POST una vez, PATCH después.
  const { currentDiagram, currentDiagramId, setCurrentDiagramId, messages } = useStore.getState()
  if (!currentDiagram || !currentDiagram.diagram_type) return { ok: false, error: 'no-diagram' }

  const isUpdate = currentDiagramId !== null
  const url = isUpdate ? `${API_URL}/diagrams/${currentDiagramId}` : `${API_URL}/diagrams`
  // Lectura fresca de messages: el done ya añadió el turno del sistema antes de
  // disparar el guardado, así que la conversación viaja completa hasta aquí.
  const body = JSON.stringify({ diagram: currentDiagram, prompt, messages })

  try {
    const res = await fetch(url, { method: isUpdate ? 'PATCH' : 'POST', headers, body })
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      return { ok: false, error: detail.error ?? `HTTP ${res.status}` }
    }
    const saved = (await res.json()) as DiagramMeta
    // Primer guardado: cacheamos el id en el store (P4) para que los siguientes
    // sean PATCH del mismo diagrama, no un segundo INSERT.
    if (!isUpdate) setCurrentDiagramId(saved.id)
    return { ok: true, id: saved.id }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

// Serialización de guardados: dos `done` seguidos (generación + refinamiento
// rápido) podrían disparar dos POST antes de que el primero fije el id →
// duplicado. Encadenar cada guardado tras el anterior lo evita; la cola
// sobrevive a un fallo (catch) para no quedarse atascada.
let queue: Promise<unknown> = Promise.resolve()

export function persistCurrentDiagram(prompt?: string): Promise<SaveResult> {
  const next = queue.then(() => doSave(prompt))
  queue = next.catch(() => undefined)
  return next
}

export async function listDiagrams(): Promise<DiagramMeta[]> {
  const headers = authHeaders()
  if (!headers) return []
  const res = await fetch(`${API_URL}/diagrams`, { headers })
  if (!res.ok) throw new Error(`No se pudo cargar el historial (HTTP ${res.status})`)
  return res.json()
}

export async function getDiagram(id: string): Promise<DiagramRow> {
  const headers = authHeaders()
  if (!headers) throw new Error('Sesión requerida')
  const res = await fetch(`${API_URL}/diagrams/${id}`, { headers })
  if (!res.ok) throw new Error(`No se pudo cargar el diagrama (HTTP ${res.status})`)
  return res.json()
}
