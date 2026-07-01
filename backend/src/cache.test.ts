import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock del cliente service_role: capturamos la cadena fluida de PostgREST para
// verificar que la clave se normaliza y que el lookup respeta el TTL.
const maybeSingle = vi.fn()
const gte = vi.fn(() => ({ maybeSingle }))
const eqModel = vi.fn(() => ({ gte }))
const eqKey = vi.fn(() => ({ eq: eqModel }))
const select = vi.fn(() => ({ eq: eqKey }))
const upsert = vi.fn(() => Promise.resolve({ error: null }))
const from = vi.fn(() => ({ select, upsert }))

vi.mock('./supabase', () => ({ supabaseService: () => ({ from }) }))

import { getCached, setCached, normalizeKey } from './cache'

describe('normalizeKey', () => {
  it('trim + minúsculas + colapsa espacios (más aciertos, decisión P2)', () => {
    expect(normalizeKey('  Crear un   ERD de Blog ')).toBe('crear un erd de blog')
  })
  it('dos prompts que solo difieren en mayúsculas/espacios comparten clave', () => {
    expect(normalizeKey('Diagrama De Flujo')).toBe(normalizeKey('diagrama  de flujo'))
  })

  // S10.2 — el tipo preseleccionado entra en la clave.
  it('AUTO (sin tipo) deja la clave IDÉNTICA a la histórica (compat hacia atrás)', () => {
    expect(normalizeKey('Crear ERD', undefined)).toBe(normalizeKey('Crear ERD'))
    expect(normalizeKey('Crear ERD')).toBe('crear erd')
  })
  it('el mismo prompt con tipos distintos NO comparte clave', () => {
    expect(normalizeKey('Crear blog', 'flowchart')).not.toBe(normalizeKey('Crear blog', 'erd'))
  })
  it('forzar un tipo difiere de dejarlo en automático', () => {
    expect(normalizeKey('Crear blog', 'erd')).not.toBe(normalizeKey('Crear blog'))
    expect(normalizeKey('Crear blog', 'erd')).toBe('crear blog|type=erd')
  })
})

describe('getCached', () => {
  beforeEach(() => vi.clearAllMocks())

  it('busca por la clave NORMALIZADA y devuelve {title, diagram} en hit', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { title: 'Blog', diagram: { nodes: [], edges: [] } }, error: null })
    const res = await getCached('  Crear   ERD ')
    expect(eqKey).toHaveBeenCalledWith('prompt_key', 'crear erd')
    expect(res).toEqual({ title: 'Blog', diagram: { nodes: [], edges: [] } })
  })

  it('aplica el filtro de TTL (created_at >= cutoff)', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    await getCached('x')
    expect(gte).toHaveBeenCalledWith('created_at', expect.any(String))
  })

  it('devuelve null en miss', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    expect(await getCached('x')).toBeNull()
  })

  it('devuelve null (no lanza) ante error de BD: la caché nunca tumba la generación', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    expect(await getCached('x')).toBeNull()
  })

  it('devuelve null (no propaga) si la consulta LANZA (catch): la caché es best-effort', async () => {
    maybeSingle.mockRejectedValueOnce(new Error('network down'))
    expect(await getCached('x')).toBeNull()
  })
})

describe('setCached', () => {
  beforeEach(() => vi.clearAllMocks())

  it('hace upsert con la clave normalizada y onConflict (sobrescribe → solo el último)', async () => {
    await setCached('  Crear ERD ', 'Blog', { nodes: [], edges: [] })
    const [row, opts] = upsert.mock.calls[0] as unknown as [Record<string, unknown>, unknown]
    expect(row.prompt_key).toBe('crear erd')
    expect(row.prompt).toBe('  Crear ERD ') // el original se conserva para depurar
    expect(opts).toEqual({ onConflict: 'prompt_key,model' })
  })

  // S10.2 — el tipo forzado entra en prompt_key al guardar.
  it('con tipo forzado, la clave incluye el sufijo de tipo', async () => {
    await setCached('Crear blog', 'Blog', { nodes: [], edges: [] }, 'flowchart')
    const [row] = upsert.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(row.prompt_key).toBe('crear blog|type=flowchart')
  })

  it('no propaga si el upsert devuelve error (best-effort, solo loguea)', async () => {
    upsert.mockResolvedValueOnce({ error: { message: 'unique violation' } })
    await expect(setCached('x', null, { nodes: [], edges: [] })).resolves.toBeUndefined()
  })

  it('no propaga si el upsert LANZA (catch): no debe romper la respuesta ya servida', async () => {
    upsert.mockRejectedValueOnce(new Error('connection reset'))
    await expect(setCached('x', null, { nodes: [], edges: [] })).resolves.toBeUndefined()
  })
})

// S10.2 — el lookup también namespacia por tipo.
describe('getCached con tipo', () => {
  beforeEach(() => vi.clearAllMocks())

  it('busca por la clave con sufijo de tipo cuando se fuerza', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    await getCached('Crear blog', 'erd')
    expect(eqKey).toHaveBeenCalledWith('prompt_key', 'crear blog|type=erd')
  })
})
