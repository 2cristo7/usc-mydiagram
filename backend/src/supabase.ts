import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// S9.3 — Cliente de Supabase POR PETICIÓN, actuando como el usuario que llama.
//
// La persistencia respeta la RLS de S9.1 (P2 del socrático): en vez de usar la
// service_role (que haría bypass de la RLS y vaciaría de sentido toda la
// seguridad de la tabla), se reenvía el JWT del propio usuario en el header
// Authorization. Así `auth.uid()` dentro de cada política resuelve al usuario
// real y la BD impone la propiedad de cada fila — el backend no decide quién ve
// qué, solo transporta la identidad.
//
// service_role queda RESERVADA para la caché global de S9.3b (escritura de
// sistema sobre una tabla sin user_id), nunca para los diagramas del usuario.
//
// El cliente se crea por petición (no se cachea): cada uno lleva el token de SU
// usuario. `persistSession`/`autoRefreshToken` desactivados — es un cliente
// efímero de servidor, sin estado de sesión que mantener.

let anonKey: string | null = null
let url: string | null = null

function config(): { url: string; anonKey: string } {
  if (!url || !anonKey) {
    url = process.env.SUPABASE_URL ?? null
    anonKey = process.env.SUPABASE_ANON_KEY ?? null
    if (!url || !anonKey) {
      throw new Error('Faltan SUPABASE_URL / SUPABASE_ANON_KEY — necesarias para la persistencia')
    }
  }
  return { url, anonKey }
}

/**
 * Crea un cliente Supabase que actúa como el usuario dueño del `accessToken`.
 * La RLS se evalúa con `auth.uid()` = ese usuario.
 */
export function supabaseForUser(accessToken: string): SupabaseClient {
  const { url, anonKey } = config()
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// S9.3b — Cliente de SISTEMA (service_role) para la caché global de generaciones.
//
// service_role hace BYPASS de la RLS: por eso se usa ÚNICAMENTE aquí, en una
// tabla sin user_id (generation_cache) que no contiene datos de usuario, y NUNCA
// para los diagramas del usuario (esos van por supabaseForUser, con RLS activa).
// La tabla tiene RLS sin políticas → solo este cliente puede leerla/escribirla,
// lo que evita el envenenamiento de la caché desde el cliente (decisión C, S9.1).
//
// Singleton: el service_role es estable, no depende de la petición.
let _service: SupabaseClient | null = null

export function supabaseService(): SupabaseClient {
  if (!_service) {
    const url = process.env.SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) {
      throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — necesarias para la caché')
    }
    _service = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return _service
}
