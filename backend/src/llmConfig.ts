import { Router, type Response } from 'express'
import { requireAuth, type AuthedRequest } from './auth'
import { supabaseForUser } from './supabase'

// S10.3 — CRUD de la configuración LLM del usuario.
//
// El usuario puede elegir qué proveedor/modelo usa para generar diagramas.
// La BD almacena la config en una tabla `llm_configs` protegida por RLS (solo el
// propio usuario puede leer/escribir su fila), con la api_key cifrada server-side.
//
// El backend expone dos operaciones:
//   GET  /llm-config   → config actual (sin keys, solo saved_providers: string[])
//   PUT  /llm-config   → upsert de la config (acepta api_key nueva, nunca la devuelve)
//   DELETE /llm-config/api-key/:provider → revoca la key de un proveedor
//
// Ambas delegan en RPCs SECURITY DEFINER de Supabase que actúan sobre auth.uid(),
// por lo que la RLS la impone la BD, no este router.

const DEFAULT_CONFIG = {
  provider: 'ollama',
  transport: 'browser',
  model_fast: '',
  model_capable: '',
  base_url: null,
  // S10.3c — proveedores con API key guardada (cifrada). Antes era has_api_key:bool.
  saved_providers: [] as string[],
}

const COMMERCIAL_PROVIDERS = ['openai', 'anthropic', 'gemini']

const router = Router()
router.use(requireAuth)

// GET /llm-config — devuelve la fila de configuración LLM del usuario.
// Si todavía no tiene fila (usuario nuevo), devuelve los defaults.
// NUNCA incluye las keys en la respuesta (solo saved_providers: string[]).
router.get('/', async (req: AuthedRequest, res: Response) => {
  const supabase = supabaseForUser(req.accessToken!)
  const { data, error } = await supabase.rpc('get_llm_config')
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  // get_llm_config devuelve array vacío si no hay fila aún
  const row = Array.isArray(data) ? data[0] : data
  res.json(row ?? DEFAULT_CONFIG)
})

// PUT /llm-config — crea o actualiza la configuración LLM del usuario.
// Campos aceptados: provider, transport, model_fast, model_capable, base_url?, api_key?
// La api_key se cifra en la BD (función SECURITY DEFINER); el gateway nunca la
// persiste ni la devuelve.
router.put('/', async (req: AuthedRequest, res: Response) => {
  const { provider, transport, model_fast, model_capable, base_url, api_key } = req.body ?? {}

  if (!provider || !transport || model_fast === undefined || model_capable === undefined) {
    res.status(400).json({ error: 'Faltan campos obligatorios: provider, transport, model_fast, model_capable' })
    return
  }

  const supabase = supabaseForUser(req.accessToken!)
  const { error } = await supabase.rpc('upsert_llm_config', {
    p_provider: provider,
    p_transport: transport,
    p_model_fast: model_fast,
    p_model_capable: model_capable,
    p_base_url: base_url ?? null,
    p_api_key: api_key ?? null,
  })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  // Nunca devolver la api_key: solo confirmación y la config sin clave.
  res.json({ ok: true, provider, transport, model_fast, model_capable, base_url: base_url ?? null })
})

// DELETE /llm-config/api-key/:provider — revoca el guardado permanente de la API
// key de UN proveedor concreto (S10.3c: multi-key). Borra el secreto de Vault y
// deja la config (proveedor/modelos) intacta.
router.delete('/api-key/:provider', async (req: AuthedRequest, res: Response) => {
  const provider = String(req.params.provider)
  if (!COMMERCIAL_PROVIDERS.includes(provider)) {
    res.status(400).json({ error: 'Proveedor no válido' })
    return
  }
  const supabase = supabaseForUser(req.accessToken!)
  const { error } = await supabase.rpc('delete_llm_api_key', { p_provider: provider })
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ ok: true })
})

export default router
