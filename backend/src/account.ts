import { Router, type Response } from 'express'
import { requireAuth, type AuthedRequest } from './auth'
import { supabaseForUser, supabaseService } from './supabase'

// S10.4 — Derechos RGPD en autoservicio: acceso/portabilidad y supresión.
//
// El RGPD reconoce al usuario el derecho de ACCESO (art. 15) y PORTABILIDAD
// (art. 20) — recibir sus datos en un formato estructurado y legible por máquina —
// y el derecho de SUPRESIÓN o "al olvido" (art. 17). Esta ruta los implementa de
// forma que el propio usuario los ejerce sin intervención manual:
//
//   GET    /account/export → vuelca TODOS los datos personales en un JSON.
//   DELETE /account        → borra la cuenta y, en cascada, todo dato asociado.
//
// Ambas exigen sesión (requireAuth). La lectura va con el JWT del usuario
// (supabaseForUser → la RLS garantiza que solo ve lo suyo); el borrado del
// usuario de auth.users necesita privilegio de administración (service_role),
// reservado y usado solo aquí para esta operación destructiva e intencional.

const router = Router()
router.use(requireAuth)

// GET /account/export — derecho de acceso y portabilidad (RGPD art. 15 y 20).
//
// Reúne en un único JSON la identidad (del propio token verificado), la
// configuración LLM (SIN las API keys: solo saved_providers — las credenciales
// nunca salen del servidor) y todos los diagramas del usuario, incluidos papelera.
// La lectura usa el cliente con el JWT del usuario: la RLS asegura que la
// exportación contiene exactamente las filas de ESE usuario y ninguna más.
router.get('/export', async (req: AuthedRequest, res: Response) => {
  const supabase = supabaseForUser(req.accessToken!)

  // Diagramas: todas las columnas, incluidos los borrados suaves (deleted_at).
  // La RLS filtra por auth.uid(), así que select('*') devuelve solo los propios.
  const { data: diagrams, error: diagErr } = await supabase
    .from('diagrams')
    .select('*')
    .order('created_at', { ascending: true })
  if (diagErr) {
    res.status(500).json({ error: diagErr.message })
    return
  }

  // Config LLM: el RPC ya excluye las keys (solo saved_providers). Array vacío si
  // nunca configuró nada.
  const { data: llmRows, error: llmErr } = await supabase.rpc('get_llm_config')
  if (llmErr) {
    res.status(500).json({ error: llmErr.message })
    return
  }
  const llm_config = Array.isArray(llmRows) ? (llmRows[0] ?? null) : (llmRows ?? null)

  const payload = {
    export_format: 'mydiagram-account-export/v1',
    generated_at: new Date().toISOString(),
    account: {
      user_id: req.userId,
      email: req.email ?? null,
    },
    llm_config,
    diagrams: diagrams ?? [],
    // Transparencia: la caché global de generaciones (generation_cache) NO tiene
    // user_id y, por diseño, es compartida y anonimizable; no forma parte de los
    // datos personales exportables de una cuenta concreta.
    notes:
      'Las API keys nunca se incluyen (solo saved_providers). La caché global de generaciones no contiene datos vinculados a tu cuenta.',
  }

  const filename = `mydiagram-datos-${(req.email ?? req.userId ?? 'cuenta').replace(/[^a-zA-Z0-9._-]/g, '_')}.json`
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(JSON.stringify(payload, null, 2))
})

// DELETE /account — derecho de supresión / "al olvido" (RGPD art. 17).
//
// Orden importante:
//   1. Borrar los secretos de Vault con el JWT del usuario (RPC
//      delete_all_llm_api_keys). Vault NO está cubierto por el `on delete cascade`
//      de auth.users, así que hay que eliminarlos explícitamente ANTES de borrar
//      al usuario o quedarían huérfanos (las referencias en user_llm_api_keys
//      desaparecen en la cascada).
//   2. Borrar al usuario de auth.users con privilegio de administración. El
//      `on delete cascade` arrastra diagrams, user_llm_config y user_llm_api_keys.
//
// Tras esto no queda ningún dato vinculado a la cuenta salvo la caché global
// (sin user_id, no personal). La operación es irreversible y se confirma en la UI.
router.delete('/', async (req: AuthedRequest, res: Response) => {
  const userId = req.userId!

  // 1. Vault: borra TODAS las keys del usuario (multi-key, S10.3c). Idempotente.
  const supabase = supabaseForUser(req.accessToken!)
  const { error: vaultErr } = await supabase.rpc('delete_all_llm_api_keys')
  if (vaultErr) {
    res.status(500).json({ error: `No se pudo borrar la credencial: ${vaultErr.message}` })
    return
  }

  // 2. auth.users (service_role): cascada sobre diagrams + user_llm_config.
  const { error: delErr } = await supabaseService().auth.admin.deleteUser(userId)
  if (delErr) {
    res.status(500).json({ error: `No se pudo eliminar la cuenta: ${delErr.message}` })
    return
  }

  res.json({ ok: true })
})

export default router
