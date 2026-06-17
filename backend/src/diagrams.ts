import { Router, type Response } from 'express'
import { requireAuth, type AuthedRequest } from './auth'
import { supabaseForUser } from './supabase'

// S9.3 — CRUD de diagramas persistidos. El gateway es el ÚNICO punto de acceso a
// datos (decisión P1: frontend → gateway → Supabase, nunca directo): centraliza
// auth y deja el frontend agnóstico de la topología de la BD.
//
// Cada handler crea un cliente Supabase con el JWT del usuario (req.accessToken):
// la RLS de S9.1 impone la propiedad de cada fila. El backend no filtra por
// user_id a mano en SELECT/UPDATE/DELETE — la política `auth.uid() = user_id` lo
// hace en la BD. En el INSERT sí escribe user_id explícito (la fila aún no
// existe) y debe coincidir con auth.uid() o el WITH CHECK lo rechaza.

const TITLE_FALLBACK = 'Diagrama sin título'

interface DiagramPayload {
  diagram?: {
    title?: string | null
    diagram_type?: string | null
    nodes?: unknown[]
    edges?: unknown[]
  }
  prompt?: string | null
  // Conversación del chat que originó/refinó el diagrama. Opcional y tolerante:
  // un cliente sin actualizar (o una generación anónima) la omite → log vacío.
  messages?: unknown[]
}

// La forma mínima que exige el CHECK de la tabla (objeto con nodes[]/edges[]) y
// que diagram_type esté presente (columna NOT NULL). Se valida aquí para dar un
// 400 accionable en vez de dejar que el INSERT reviente con un error de Postgres.
function validate(payload: DiagramPayload): { ok: true } | { ok: false; error: string } {
  const d = payload?.diagram
  if (!d || typeof d !== 'object') return { ok: false, error: 'Falta el diagrama' }
  if (!d.diagram_type) return { ok: false, error: 'Falta diagram_type' }
  if (!Array.isArray(d.nodes) || !Array.isArray(d.edges)) {
    return { ok: false, error: 'El diagrama debe tener nodes[] y edges[]' }
  }
  return { ok: true }
}

// Construye las columnas a partir del payload. title se rellena con fallback si
// el agente devolvió null (decisión #2 de S9.1: la columna es NOT NULL y el
// backend garantiza el valor, no la UI).
//
// `prompt` solo se incluye en el INSERT (withPrompt=true): es el prompt que
// ORIGINA el diagrama y nunca debe editarse. Los PATCH posteriores (mover un
// nodo, export, refinamiento) omiten la columna para preservar el valor
// original; incluirla con `?? null` la machacaría y dejaría "Regenerar"
// desactivado al recargar desde el historial.
function columns(payload: DiagramPayload, withPrompt = true) {
  const d = payload.diagram!
  return {
    title: d.title?.trim() || TITLE_FALLBACK,
    diagram_type: d.diagram_type,
    ...(withPrompt ? { prompt: payload.prompt ?? null } : {}),
    data: d,
    // El CHECK diagrams_messages_is_array exige un array: si no llega, log vacío.
    messages: Array.isArray(payload.messages) ? payload.messages : [],
  }
}

const router = Router()
router.use(requireAuth)

// Lista del historial: solo metadata (P5), ordenada por el índice (user_id,
// updated_at desc) de S9.1. El data completo se trae al abrir un diagrama.
router.get('/', async (req: AuthedRequest, res: Response) => {
  const supabase = supabaseForUser(req.accessToken!)
  const { data, error } = await supabase
    .from('diagrams')
    .select('id, title, diagram_type, created_at, updated_at')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
  if (error) {
    // Logueamos el error real en servidor para no filtrar internos de Postgres al cliente.
    console.error('[diagrams] error al listar:', error)
    res.status(500).json({ error: 'Error interno del servidor. Inténtalo de nuevo.' })
    return
  }
  res.json(data)
})

// Papelera: los diagramas con borrado suave, ordenados por fecha de borrado.
// Debe declararse antes que GET /:id o '/trash' casaría con el patrón /:id.
router.get('/trash', async (req: AuthedRequest, res: Response) => {
  const supabase = supabaseForUser(req.accessToken!)
  const { data, error } = await supabase
    .from('diagrams')
    .select('id, title, diagram_type, created_at, updated_at, deleted_at')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
  if (error) {
    console.error('[diagrams] error al listar papelera:', error)
    res.status(500).json({ error: 'Error interno del servidor. Inténtalo de nuevo.' })
    return
  }
  res.json(data)
})

// Un diagrama completo (incluye data) para cargarlo al canvas. La RLS hace que
// un id de otro usuario devuelva 0 filas → 404, sin filtrar por user_id a mano.
router.get('/:id', async (req: AuthedRequest, res: Response) => {
  const supabase = supabaseForUser(req.accessToken!)
  const { data, error } = await supabase
    .from('diagrams')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle()
  if (error) {
    console.error('[diagrams] error al obtener diagrama:', error)
    res.status(500).json({ error: 'Error interno del servidor. Inténtalo de nuevo.' })
    return
  }
  if (!data) {
    res.status(404).json({ error: 'Diagrama no encontrado' })
    return
  }
  res.json(data)
})

// Primer guardado: INSERT. Devuelve el id nuevo, que el frontend cachea en el
// store (P4) para que los guardados siguientes sean PATCH.
router.post('/', async (req: AuthedRequest, res: Response) => {
  const v = validate(req.body)
  if (!v.ok) {
    res.status(400).json({ error: v.error })
    return
  }
  const supabase = supabaseForUser(req.accessToken!)
  const { data, error } = await supabase
    .from('diagrams')
    .insert({ user_id: req.userId, ...columns(req.body) })
    .select('id, title, diagram_type, created_at, updated_at')
    .single()
  if (error) {
    console.error('[diagrams] error al crear diagrama:', error)
    res.status(500).json({ error: 'Error interno del servidor. Inténtalo de nuevo.' })
    return
  }
  res.status(201).json(data)
})

// Guardados sucesivos: UPDATE de un diagrama ya existente. La RLS impide tocar
// uno ajeno (0 filas → 404). updated_at lo refresca el trigger de S9.1.
router.patch('/:id', async (req: AuthedRequest, res: Response) => {
  const v = validate(req.body)
  if (!v.ok) {
    res.status(400).json({ error: v.error })
    return
  }
  const supabase = supabaseForUser(req.accessToken!)
  const { data, error } = await supabase
    .from('diagrams')
    .update(columns(req.body, false))
    .eq('id', req.params.id)
    .select('id, title, diagram_type, created_at, updated_at')
    .maybeSingle()
  if (error) {
    console.error('[diagrams] error al actualizar diagrama:', error)
    res.status(500).json({ error: 'Error interno del servidor. Inténtalo de nuevo.' })
    return
  }
  if (!data) {
    res.status(404).json({ error: 'Diagrama no encontrado' })
    return
  }
  res.json(data)
})

// Restaurar: saca un diagrama de la papelera (deleted_at → null). El trigger de
// updated_at lo refresca, así que vuelve arriba del historial al restaurar.
router.post('/:id/restore', async (req: AuthedRequest, res: Response) => {
  const supabase = supabaseForUser(req.accessToken!)
  const { data, error } = await supabase
    .from('diagrams')
    .update({ deleted_at: null })
    .eq('id', req.params.id)
    .select('id')
    .maybeSingle()
  if (error) {
    console.error('[diagrams] error al restaurar diagrama:', error)
    res.status(500).json({ error: 'Error interno del servidor. Inténtalo de nuevo.' })
    return
  }
  if (!data) {
    res.status(404).json({ error: 'Diagrama no encontrado' })
    return
  }
  res.status(204).end()
})

// Borrado definitivo: DELETE físico de una fila ya en la papelera. La RLS impide
// tocar una ajena (0 filas → 404).
router.delete('/:id/permanent', async (req: AuthedRequest, res: Response) => {
  const supabase = supabaseForUser(req.accessToken!)
  const { data, error } = await supabase
    .from('diagrams')
    .delete()
    .eq('id', req.params.id)
    .select('id')
    .maybeSingle()
  if (error) {
    console.error('[diagrams] error al borrar definitivamente diagrama:', error)
    res.status(500).json({ error: 'Error interno del servidor. Inténtalo de nuevo.' })
    return
  }
  if (!data) {
    res.status(404).json({ error: 'Diagrama no encontrado' })
    return
  }
  res.status(204).end()
})

// Vaciar papelera: DELETE físico de todas las filas en papelera del usuario. El
// filtro deleted_at not null evita borrar diagramas activos; la RLS lo acota al
// usuario. Debe declararse antes que DELETE /:id ('/trash' casaría con /:id).
router.delete('/trash', async (req: AuthedRequest, res: Response) => {
  const supabase = supabaseForUser(req.accessToken!)
  const { error } = await supabase
    .from('diagrams')
    .delete()
    .not('deleted_at', 'is', null)
  if (error) {
    console.error('[diagrams] error al vaciar papelera:', error)
    res.status(500).json({ error: 'Error interno del servidor. Inténtalo de nuevo.' })
    return
  }
  res.status(204).end()
})

// Borrado suave: mueve un diagrama a la papelera (deleted_at = now). La RLS
// impide tocar uno ajeno; pedimos la fila de vuelta para distinguir "no existe /
// no es tuyo" (0 filas → 404). El DELETE físico vive en /:id/permanent.
router.delete('/:id', async (req: AuthedRequest, res: Response) => {
  const supabase = supabaseForUser(req.accessToken!)
  const { data, error } = await supabase
    .from('diagrams')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()
  if (error) {
    console.error('[diagrams] error al mover a papelera:', error)
    res.status(500).json({ error: 'Error interno del servidor. Inténtalo de nuevo.' })
    return
  }
  if (!data) {
    res.status(404).json({ error: 'Diagrama no encontrado' })
    return
  }
  res.status(204).end()
})

export default router
