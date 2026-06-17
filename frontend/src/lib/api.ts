import { useStore } from '../store/index'
import { useAuthStore } from '../store/auth'
import type { DiagramSchema, Message } from '../types'

// S9.3 — Cliente REST de persistencia. El frontend NUNCA habla con Supabase
// directamente (decisión P1): toda la persistencia pasa por el gateway, que es
// el único punto de acceso a datos. Aquí solo se adjunta el Bearer de la sesión;
// la RLS la impone Supabase del otro lado del gateway.

// URL del gateway: configurable por entorno (VITE_API_URL) con fallback a local
// para desarrollo. Sin esto, cualquier despliegue no-local rompe todas las
// llamadas REST. El WebSocket usa su propia var (VITE_WS_URL en useWebSocket).
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

// Metadata del historial (P5): lo que devuelve GET /diagrams, sin el `data`.
export interface DiagramMeta {
  id: string
  title: string
  diagram_type: string
  created_at: string
  updated_at: string
  // Solo presente en las filas de la papelera (GET /diagrams/trash).
  deleted_at?: string | null
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

// Borrado suave: mueve el diagrama a la papelera.
export async function deleteDiagram(id: string): Promise<void> {
  const headers = authHeaders()
  if (!headers) throw new Error('Sesión requerida')
  const res = await fetch(`${API_URL}/diagrams/${id}`, { method: 'DELETE', headers })
  if (!res.ok) throw new Error(`No se pudo eliminar el diagrama (HTTP ${res.status})`)
}

// Diagramas en la papelera (borrado suave), más recientes primero.
export async function listTrash(): Promise<DiagramMeta[]> {
  const headers = authHeaders()
  if (!headers) return []
  const res = await fetch(`${API_URL}/diagrams/trash`, { headers })
  if (!res.ok) throw new Error(`No se pudo cargar la papelera (HTTP ${res.status})`)
  return res.json()
}

// Saca un diagrama de la papelera y lo devuelve al historial.
export async function restoreDiagram(id: string): Promise<void> {
  const headers = authHeaders()
  if (!headers) throw new Error('Sesión requerida')
  const res = await fetch(`${API_URL}/diagrams/${id}/restore`, { method: 'POST', headers })
  if (!res.ok) throw new Error(`No se pudo restaurar el diagrama (HTTP ${res.status})`)
}

// Borrado definitivo (físico) de un diagrama ya en la papelera.
export async function deleteDiagramPermanent(id: string): Promise<void> {
  const headers = authHeaders()
  if (!headers) throw new Error('Sesión requerida')
  const res = await fetch(`${API_URL}/diagrams/${id}/permanent`, { method: 'DELETE', headers })
  if (!res.ok) throw new Error(`No se pudo eliminar definitivamente (HTTP ${res.status})`)
}

// Vacía la papelera: borrado físico de todos los diagramas en ella.
export async function emptyTrash(): Promise<void> {
  const headers = authHeaders()
  if (!headers) throw new Error('Sesión requerida')
  const res = await fetch(`${API_URL}/diagrams/trash`, { method: 'DELETE', headers })
  if (!res.ok) throw new Error(`No se pudo vaciar la papelera (HTTP ${res.status})`)
}

// --- Configuración LLM por usuario (proveedor + modelos + transporte) ---
// La api_key nunca se devuelve: el backend solo informa de `has_api_key`.
export interface LlmConfig {
  provider: 'openai' | 'anthropic' | 'gemini' | 'ollama'
  transport: 'api' | 'direct' | 'browser'
  model_fast: string
  model_capable: string
  base_url?: string
  // S10.3c — proveedores comerciales con API key guardada (cifrada) a la vez.
  saved_providers: string[]
}

export interface LlmConfigPayload {
  provider: 'openai' | 'anthropic' | 'gemini' | 'ollama'
  transport: 'api' | 'direct' | 'browser'
  model_fast: string
  model_capable: string
  base_url?: string
  // Solo se envía si el usuario introduce una key nueva; null/ausente la deja intacta.
  api_key?: string
}

// La config es POR USUARIO (RLS vía auth.uid()): requiere el Bearer de la sesión.
export async function getLlmConfig(): Promise<LlmConfig> {
  const headers = authHeaders()
  if (!headers) throw new Error('Sesión requerida')
  const res = await fetch(`${API_URL}/llm-config`, { headers })
  if (!res.ok) throw new Error(`No se pudo obtener la configuración LLM (HTTP ${res.status})`)
  return res.json()
}

export async function putLlmConfig(payload: LlmConfigPayload): Promise<void> {
  const headers = authHeaders()
  if (!headers) throw new Error('Sesión requerida')
  const res = await fetch(`${API_URL}/llm-config`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(detail.error ?? `No se pudo guardar la configuración LLM (HTTP ${res.status})`)
  }
}

// Revoca el guardado permanente de la API key de UN proveedor (borra de Vault).
// La fila de config (proveedor/modelos) permanece; solo desaparece la credencial.
export async function deleteLlmApiKey(provider: string): Promise<void> {
  const headers = authHeaders()
  if (!headers) throw new Error('Sesión requerida')
  const res = await fetch(`${API_URL}/llm-config/api-key/${encodeURIComponent(provider)}`, {
    method: 'DELETE',
    headers,
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(detail.error ?? `No se pudo borrar la API key (HTTP ${res.status})`)
  }
}

// --- Derechos RGPD en autoservicio (S10.4) ---

// Acceso/portabilidad (RGPD art. 15 y 20): descarga TODOS los datos de la cuenta
// en un JSON. El backend marca Content-Disposition; aquí se materializa el blob
// y se dispara la descarga sin navegar fuera de la app.
export async function exportAccountData(): Promise<void> {
  const headers = authHeaders()
  if (!headers) throw new Error('Sesión requerida')
  const res = await fetch(`${API_URL}/account/export`, { headers })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(detail.error ?? `No se pudieron exportar los datos (HTTP ${res.status})`)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'mydiagram-datos.json'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// Supresión / "derecho al olvido" (RGPD art. 17): borra la cuenta y, en cascada,
// todos los datos asociados. Irreversible — la UI exige confirmación explícita.
export async function deleteAccount(): Promise<void> {
  const headers = authHeaders()
  if (!headers) throw new Error('Sesión requerida')
  const res = await fetch(`${API_URL}/account`, { method: 'DELETE', headers })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(detail.error ?? `No se pudo eliminar la cuenta (HTTP ${res.status})`)
  }
}
