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
})

describe('setCached', () => {
  beforeEach(() => vi.clearAllMocks())

  it('hace upsert con la clave normalizada y onConflict (sobrescribe → solo el último)', async () => {
    await setCached('  Crear ERD ', 'Blog', { nodes: [], edges: [] })
    const [row, opts] = upsert.mock.calls[0]
    expect(row.prompt_key).toBe('crear erd')
    expect(row.prompt).toBe('  Crear ERD ') // el original se conserva para depurar
    expect(opts).toEqual({ onConflict: 'prompt_key,model' })
  })
})
