import { useStore } from '../store/index'
import { useAuthStore } from '../store/auth'
import type { DiagramSchema, VersionMeta, VersionOrigin, OpSummary } from '../types'

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

// Fila completa: metadata + data (el diagrama para cargar al canvas) + el prompt
// de origen (S9.3b: permite regenerar un diagrama cargado del historial). El
// historial de conversación ya no vive aquí: se deriva del diario de versiones
// (GET /diagrams/:id/versions), que se carga aparte al abrir el diagrama.
export interface DiagramRow extends DiagramMeta {
  data: DiagramSchema
  prompt: string | null
}

// Una versión completa del diario (con su snapshot) — la devuelve GET de una
// versión concreta al navegar a ella.
export interface DiagramVersionRow extends VersionMeta {
  diagram_id: string
  user_id: string
  data: DiagramSchema
}

// Contexto de la OPERACIÓN que produce un guardado. Define qué versión se anota
// en el diario. Sin contexto, el guardado es una edición manual (autosave).
export interface SaveContext {
  prompt?: string
  origin?: VersionOrigin
  instruction?: string | null
  op_summary?: OpSummary | null
}

export interface SaveResult {
  ok: boolean
  id?: string
  // Versión recién creada en el diario (la devuelve POST/PATCH): el store la
  // añade a `versions` para que la navegación ◀ ▶ y la lista la vean al instante.
  version?: VersionMeta
  error?: string
}

function authHeaders(): Record<string, string> | null {
  const token = useAuthStore.getState().session?.access_token
  if (!token) return null
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

// Timeout por defecto de cada petición REST. Sin él, si el servidor acepta la
// conexión pero no responde (proxy colgado, microservicio bloqueado…), la promesa
// del fetch queda pendiente para siempre y los flags `loading` de la UI nunca se
// apagan. Aquí cortamos a los 30 s con un mensaje legible.
const DEFAULT_TIMEOUT_MS = 30_000

// fetch con timeout vía AbortController: aborta la petición pasado `timeoutMs` y
// lanza un Error legible (en vez del críptico "The operation was aborted") para que
// el consumidor lo muestre tal cual. Cualquier otro fallo de red se propaga intacto.
async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (err) {
    // Distinguimos el aborto por timeout (AbortError) del resto de fallos de red:
    // solo el primero merece el mensaje de "tardó demasiado".
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('La petición tardó demasiado. Revisa tu conexión.')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// Parseo JSON protegido para los GET: tras `if (!res.ok) throw`, confiar en
// `res.json()` a ciegas es frágil — un 2xx con cuerpo HTML (página de error de un
// proxy, redirect mal configurado) lanza un SyntaxError críptico. Aquí lo
// envolvemos en un mensaje legible para el consumidor.
async function parseJson<T>(res: Response, what: string): Promise<T> {
  try {
    return (await res.json()) as T
  } catch {
    throw new Error(`Respuesta inesperada del servidor al ${what}.`)
  }
}

async function doSave(ctx?: SaveContext): Promise<SaveResult> {
  const headers = authHeaders()
  if (!headers) return { ok: false, error: 'no-session' }

  // Lectura FRESCA del store: al estar serializado, un guardado encadenado ve
  // ya el id que fijó el anterior → POST una vez, PATCH después.
  const { currentDiagram, currentDiagramId, currentVersionId, setCurrentDiagramId } = useStore.getState()
  if (!currentDiagram || !currentDiagram.diagram_type) return { ok: false, error: 'no-diagram' }

  const isUpdate = currentDiagramId !== null
  const url = isUpdate ? `${API_URL}/diagrams/${currentDiagramId}` : `${API_URL}/diagrams`
  // Cada guardado anota una versión en el diario; `version` describe la operación
  // (generate/refine/manual_edit) y de qué versión se deriva (parent_id = posición
  // actual en el árbol). Sin contexto → manual_edit (autosave).
  const body = JSON.stringify({
    diagram: currentDiagram,
    prompt: ctx?.prompt,
    version: {
      origin: ctx?.origin ?? 'manual_edit',
      instruction: ctx?.instruction ?? null,
      op_summary: ctx?.op_summary ?? null,
      parent_id: currentVersionId,
    },
  })

  try {
    const res = await fetchWithTimeout(url, { method: isUpdate ? 'PATCH' : 'POST', headers, body })
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      return { ok: false, error: detail.error ?? `HTTP ${res.status}` }
    }
    const saved = (await res.json()) as DiagramMeta & { version?: VersionMeta }
    // Primer guardado: cacheamos el id en el store (P4) para que los siguientes
    // sean PATCH del mismo diagrama, no un segundo INSERT.
    if (!isUpdate) setCurrentDiagramId(saved.id)
    return { ok: true, id: saved.id, version: saved.version ?? undefined }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

// Serialización de guardados: dos `done` seguidos (generación + refinamiento
// rápido) podrían disparar dos POST antes de que el primero fije el id →
// duplicado. Encadenar cada guardado tras el anterior lo evita; la cola
// sobrevive a un fallo (catch) para no quedarse atascada.
let queue: Promise<unknown> = Promise.resolve()

export function persistCurrentDiagram(ctx?: SaveContext): Promise<SaveResult> {
  const next = queue.then(() => doSave(ctx))
  queue = next.catch(() => undefined)
  return next
}

// Diario de versiones de un diagrama (metadata, sin snapshots). Lo carga la
// apertura de un diagrama del historial para poblar la lista de operaciones y
// habilitar la navegación ◀ ▶.
export async function listVersions(diagramId: string): Promise<VersionMeta[]> {
  const headers = authHeaders()
  if (!headers) return []
  const res = await fetchWithTimeout(`${API_URL}/diagrams/${diagramId}/versions`, { headers })
  if (!res.ok) throw new Error(`No se pudo cargar el historial de versiones (HTTP ${res.status})`)
  return parseJson<VersionMeta[]>(res, 'cargar el historial de versiones')
}

// Una versión completa (con su snapshot) para previsualizarla al navegar a ella.
export async function getVersion(diagramId: string, versionId: string): Promise<DiagramVersionRow> {
  const headers = authHeaders()
  if (!headers) throw new Error('Sesión requerida')
  const res = await fetchWithTimeout(`${API_URL}/diagrams/${diagramId}/versions/${versionId}`, { headers })
  if (!res.ok) throw new Error(`No se pudo cargar la versión (HTTP ${res.status})`)
  return parseJson<DiagramVersionRow>(res, 'cargar la versión')
}

// Contrato unificado (igual que getDiagram/getVersion): sin token LANZA 'Sesión
// requerida' en vez de devolver [] silencioso. Así la UI distingue "no autenticado"
// de "lista legítimamente vacía" (un array vacío del servidor).
export async function listDiagrams(): Promise<DiagramMeta[]> {
  const headers = authHeaders()
  if (!headers) throw new Error('Sesión requerida')
  const res = await fetchWithTimeout(`${API_URL}/diagrams`, { headers })
  if (!res.ok) throw new Error(`No se pudo cargar el historial (HTTP ${res.status})`)
  return parseJson<DiagramMeta[]>(res, 'cargar el historial')
}

export async function getDiagram(id: string): Promise<DiagramRow> {
  const headers = authHeaders()
  if (!headers) throw new Error('Sesión requerida')
  const res = await fetchWithTimeout(`${API_URL}/diagrams/${id}`, { headers })
  if (!res.ok) throw new Error(`No se pudo cargar el diagrama (HTTP ${res.status})`)
  return parseJson<DiagramRow>(res, 'cargar el diagrama')
}

// Renombrar: cambia solo el título (columna + data.title), sin crear versión en
// el diario. Sirve igual para el diagrama abierto y para uno del historial que no
// está cargado en el canvas. Devuelve la metadata actualizada.
export async function renameDiagram(id: string, title: string): Promise<DiagramMeta> {
  const headers = authHeaders()
  if (!headers) throw new Error('Sesión requerida')
  const res = await fetchWithTimeout(`${API_URL}/diagrams/${id}/rename`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ title }),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(detail.error ?? `No se pudo renombrar el diagrama (HTTP ${res.status})`)
  }
  return parseJson<DiagramMeta>(res, 'renombrar el diagrama')
}

// Borrado suave: mueve el diagrama a la papelera.
export async function deleteDiagram(id: string): Promise<void> {
  const headers = authHeaders()
  if (!headers) throw new Error('Sesión requerida')
  const res = await fetchWithTimeout(`${API_URL}/diagrams/${id}`, { method: 'DELETE', headers })
  if (!res.ok) throw new Error(`No se pudo eliminar el diagrama (HTTP ${res.status})`)
}

// Diagramas en la papelera (borrado suave), más recientes primero. Mismo contrato
// que listDiagrams: sin token LANZA 'Sesión requerida' (no devuelve [] silencioso).
export async function listTrash(): Promise<DiagramMeta[]> {
  const headers = authHeaders()
  if (!headers) throw new Error('Sesión requerida')
  const res = await fetchWithTimeout(`${API_URL}/diagrams/trash`, { headers })
  if (!res.ok) throw new Error(`No se pudo cargar la papelera (HTTP ${res.status})`)
  return parseJson<DiagramMeta[]>(res, 'cargar la papelera')
}

// Saca un diagrama de la papelera y lo devuelve al historial.
export async function restoreDiagram(id: string): Promise<void> {
  const headers = authHeaders()
  if (!headers) throw new Error('Sesión requerida')
  const res = await fetchWithTimeout(`${API_URL}/diagrams/${id}/restore`, { method: 'POST', headers })
  if (!res.ok) throw new Error(`No se pudo restaurar el diagrama (HTTP ${res.status})`)
}

// Borrado definitivo (físico) de un diagrama ya en la papelera.
export async function deleteDiagramPermanent(id: string): Promise<void> {
  const headers = authHeaders()
  if (!headers) throw new Error('Sesión requerida')
  const res = await fetchWithTimeout(`${API_URL}/diagrams/${id}/permanent`, { method: 'DELETE', headers })
  if (!res.ok) throw new Error(`No se pudo eliminar definitivamente (HTTP ${res.status})`)
}

// Vacía la papelera: borrado físico de todos los diagramas en ella.
export async function emptyTrash(): Promise<void> {
  const headers = authHeaders()
  if (!headers) throw new Error('Sesión requerida')
  const res = await fetchWithTimeout(`${API_URL}/diagrams/trash`, { method: 'DELETE', headers })
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
  const res = await fetchWithTimeout(`${API_URL}/llm-config`, { headers })
  if (!res.ok) throw new Error(`No se pudo obtener la configuración LLM (HTTP ${res.status})`)
  return parseJson<LlmConfig>(res, 'obtener la configuración LLM')
}

export async function putLlmConfig(payload: LlmConfigPayload): Promise<void> {
  const headers = authHeaders()
  if (!headers) throw new Error('Sesión requerida')
  const res = await fetchWithTimeout(`${API_URL}/llm-config`, {
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
  const res = await fetchWithTimeout(`${API_URL}/llm-config/api-key/${encodeURIComponent(provider)}`, {
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
  // Timeout holgado: la exportación serializa TODA la cuenta (puede tardar más
  // que una petición normal).
  const res = await fetchWithTimeout(`${API_URL}/account/export`, { headers }, 60_000)
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
  const res = await fetchWithTimeout(`${API_URL}/account`, { method: 'DELETE', headers })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(detail.error ?? `No se pudo eliminar la cuenta (HTTP ${res.status})`)
  }
}
