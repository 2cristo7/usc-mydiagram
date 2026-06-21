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

// Proveedores válidos para la config: los comerciales + el local (ollama, el
// valor por defecto de DEFAULT_CONFIG). COMMERCIAL_PROVIDERS sigue acotando dónde
// tiene sentido guardar una API key (Vault); aquí se valida el enum completo.
const VALID_PROVIDERS = [...COMMERCIAL_PROVIDERS, 'ollama']

// Rechaza una base_url de usuario que apunte (de forma evidente) a un host interno.
// Es la primera línea anti-SSRF: el agente, que es quien hace la petición, resuelve
// el DNS y vuelve a validar; aquí bloqueamos los vectores literales obvios (IPs
// privadas, loopback, link-local/metadatos del cloud) y damos feedback inmediato.
// Solo se permite http(s); un Ollama interno legítimo se configura por env, no aquí.
function isUnsafeLlmBaseUrl(raw: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return true
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::1' || host === '::') return true // IPv6 loopback / unspecified

  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    if (a === 0 || a === 127) return true // this-host / loopback
    if (a === 10) return true // privado
    if (a === 169 && b === 254) return true // link-local (metadatos del cloud)
    if (a === 172 && b >= 16 && b <= 31) return true // privado
    if (a === 192 && b === 168) return true // privado
  }
  return false
}

const router = Router()
router.use(requireAuth)

// GET /llm-config — devuelve la fila de configuración LLM del usuario.
// Si todavía no tiene fila (usuario nuevo), devuelve los defaults.
// NUNCA incluye las keys en la respuesta (solo saved_providers: string[]).
router.get('/', async (req: AuthedRequest, res: Response) => {
  const supabase = supabaseForUser(req.accessToken!)
  const { data, error } = await supabase.rpc('get_llm_config')
  if (error) {
    console.error('[llm-config] error al leer la configuración:', error)
    res.status(500).json({ error: 'No se pudo leer la configuración.' })
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

  // Validación de tipos y enum (no solo presencia): provider/transport deben ser
  // strings y provider debe pertenecer a la lista soportada. Evita persistir una
  // config que luego no resuelve ningún proveedor real.
  if (typeof provider !== 'string' || typeof transport !== 'string') {
    res.status(400).json({ error: 'provider y transport deben ser cadenas de texto.' })
    return
  }
  if (!VALID_PROVIDERS.includes(provider)) {
    res.status(400).json({ error: 'Proveedor no válido.' })
    return
  }

  if (base_url != null && base_url !== '') {
    if (typeof base_url !== 'string' || isUnsafeLlmBaseUrl(base_url)) {
      res.status(400).json({ error: 'base_url no válida: debe ser una URL http(s) hacia un host público.' })
      return
    }
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
    console.error('[llm-config] error al guardar la configuración:', error)
    res.status(500).json({ error: 'No se pudo guardar la configuración.' })
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
    console.error('[llm-config] error al revocar la API key:', error)
    res.status(500).json({ error: 'No se pudo revocar la credencial.' })
    return
  }
  res.json({ ok: true })
})

export default router
