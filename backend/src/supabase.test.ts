import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Test del cliente fino de Supabase (supabase.ts). No hay lógica de negocio: lo
// testeable es la construcción del cliente (con qué url/headers/opciones), la
// guarda de variables de entorno ausentes y el cacheo (singleton del service_role,
// memoización de la config del cliente-por-usuario). createClient se mockea: no se
// abre ninguna conexión real, solo se inspecciona CÓMO se invoca.

const createClient = vi.fn((url: string, key: string, opts: unknown) => ({ __url: url, __key: key, __opts: opts }))
vi.mock('@supabase/supabase-js', () => ({ createClient: (...a: unknown[]) => createClient(...(a as [string, string, unknown])) }))

import { supabaseForUser, supabaseService } from './supabase'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('supabaseForUser (cliente por petición, RLS del usuario)', () => {
  it('crea el cliente con el JWT del usuario en el header Authorization', () => {
    process.env.SUPABASE_URL = 'https://proj.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'anon-key'
    supabaseForUser('user-jwt')
    expect(createClient).toHaveBeenCalledTimes(1)
    const [url, key, opts] = createClient.mock.calls[0] as [string, string, Record<string, any>]
    expect(url).toBe('https://proj.supabase.co')
    expect(key).toBe('anon-key')
    // El JWT del usuario viaja como Bearer: la RLS resuelve auth.uid() a ese usuario.
    expect(opts.global.headers.Authorization).toBe('Bearer user-jwt')
    // Cliente efímero de servidor: sin sesión persistente ni auto-refresh.
    expect(opts.auth).toEqual({ persistSession: false, autoRefreshToken: false })
  })

  it('cada petición crea un cliente nuevo con SU token (no se reutiliza entre usuarios)', () => {
    process.env.SUPABASE_URL = 'https://proj.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'anon-key'
    supabaseForUser('token-a')
    supabaseForUser('token-b')
    expect(createClient).toHaveBeenCalledTimes(2)
    const optsA = createClient.mock.calls[0][2] as Record<string, any>
    const optsB = createClient.mock.calls[1][2] as Record<string, any>
    expect(optsA.global.headers.Authorization).toBe('Bearer token-a')
    expect(optsB.global.headers.Authorization).toBe('Bearer token-b')
  })

  it('lanza si faltan SUPABASE_URL / SUPABASE_ANON_KEY', async () => {
    // El módulo importado estáticamente puede tener ya la config memoizada por
    // otros tests; reimportamos fresco para ejercitar la guarda sin estado previo.
    vi.resetModules()
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_ANON_KEY
    const fresh = await import('./supabase')
    expect(() => fresh.supabaseForUser('x')).toThrow(/SUPABASE_URL/)
  })

  it('memoiza la config: una segunda llamada no relee el entorno', () => {
    // La config se cachea en variables de módulo. Si la primera llamada la lee bien,
    // la segunda reusa los valores aunque el entorno cambie después.
    process.env.SUPABASE_URL = 'https://proj.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'anon-key'
    supabaseForUser('t1')
    delete process.env.SUPABASE_URL // ya no debería leerse
    expect(() => supabaseForUser('t2')).not.toThrow()
    expect(createClient).toHaveBeenLastCalledWith('https://proj.supabase.co', 'anon-key', expect.anything())
  })
})

describe('supabaseService (cliente de sistema service_role, singleton)', () => {
  it('crea el cliente con la service_role key, sin sesión persistente', () => {
    process.env.SUPABASE_URL = 'https://proj.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
    const client = supabaseService()
    expect(createClient).toHaveBeenCalledTimes(1)
    const [url, key, opts] = createClient.mock.calls[0] as [string, string, Record<string, any>]
    expect(url).toBe('https://proj.supabase.co')
    expect(key).toBe('service-key')
    expect(opts.auth).toEqual({ persistSession: false, autoRefreshToken: false })
    expect(client).toBeDefined()
  })

  it('singleton: llamadas sucesivas devuelven la MISMA instancia (no recrea)', () => {
    process.env.SUPABASE_URL = 'https://proj.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
    const a = supabaseService()
    const b = supabaseService()
    expect(a).toBe(b)
    // createClient pudo invocarse en otros tests del bloque; lo clave es que entre
    // estas dos llamadas no se volvió a crear (misma referencia).
  })

  it('lanza si faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY', async () => {
    // El singleton ya quedó cacheado por los tests previos de este bloque, así que
    // reimportamos el módulo fresco para ejercitar la rama de error sin estado previo.
    vi.resetModules()
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    const fresh = await import('./supabase')
    expect(() => fresh.supabaseService()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })
})
