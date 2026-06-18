import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import express from 'express'
import request from 'supertest'

// S9.4 — Test de integración del CRUD (S9.3). Montamos el router REAL en una app
// Express y lo golpeamos con peticiones (decisión P1=a): el bug que importa no es
// que `validate` falle, sino el CABLEADO — que requireAuth gatee cada ruta, que
// los status se mapeen bien, y el invariante de seguridad de P2: el backend NO
// filtra por user_id a mano (confía en la RLS) salvo el INSERT, que lo escribe.
//
// Mockeamos jose (el handshake JWT) y supabaseForUser (la BD). requireAuth corre
// de verdad: así se prueba el gate, no una versión falsa del middleware.

const jwtVerify = vi.fn()
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => 'jwks-fn'),
  jwtVerify: (...args: unknown[]) => jwtVerify(...args),
}))

// Builder fluido de PostgREST: cada método encadenable registra su llamada y
// devuelve el propio builder; es thenable (await builder → result) para el GET de
// lista, y single/maybeSingle resuelven el result configurado por test.
let result: { data: unknown; error: unknown } = { data: null, error: null }
// Acumula las llamadas a TODOS los builders de la petición (cada `.from()` crea
// uno nuevo). Desde S10.3 una escritura golpea dos tablas (diagrams + el diario
// diagram_versions), así que `calls` no se reinicia por builder sino por test
// (beforeEach): calls.insert[0] sigue siendo el INSERT del diagrama, [1] el de la
// versión. Se resetea en beforeEach.
let calls: Record<string, unknown[][]> = {}

function makeBuilder() {
  const record = (name: string) => (...args: unknown[]) => {
    ;(calls[name] ||= []).push(args)
    return builder
  }
  const builder: Record<string, unknown> = {
    select: record('select'),
    insert: record('insert'),
    update: record('update'),
    eq: record('eq'),
    is: record('is'),
    not: record('not'),
    order: record('order'),
    limit: record('limit'),
    single: vi.fn(() => Promise.resolve(result)),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (r: typeof result) => unknown) => resolve(result),
  }
  return builder
}

const fromMock = vi.fn(() => makeBuilder())
vi.mock('./supabase', () => ({
  supabaseForUser: vi.fn(() => ({ from: fromMock })),
}))

beforeAll(() => {
  process.env.SUPABASE_URL = 'https://proj.supabase.co'
})

import diagramsRouter from './diagrams'

const app = express()
app.use(express.json())
app.use('/diagrams', diagramsRouter)

const VALID = { authorization: 'Bearer good-token' }
const sampleDiagram = { title: 'Blog', diagram_type: 'erd', nodes: [{ id: 'n1' }], edges: [] }

function authOk() {
  jwtVerify.mockResolvedValue({ payload: { sub: 'user-123' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  result = { data: null, error: null }
  calls = {}
})

describe('gate de autenticación (requireAuth en router.use)', () => {
  it('401 sin token en CUALQUIER ruta del router', async () => {
    const res = await request(app).get('/diagrams')
    expect(res.status).toBe(401)
  })

  it('401 con token inválido', async () => {
    jwtVerify.mockRejectedValueOnce(new Error('bad'))
    const res = await request(app).post('/diagrams').set(VALID).send({ diagram: sampleDiagram })
    expect(res.status).toBe(401)
  })
})

describe('POST /diagrams (INSERT)', () => {
  beforeEach(authOk)

  it('400 si el payload no trae diagram_type (validación antes del INSERT)', async () => {
    const res = await request(app)
      .post('/diagrams')
      .set(VALID)
      .send({ diagram: { nodes: [], edges: [] } })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/diagram_type/)
  })

  it('400 si faltan nodes[]/edges[]', async () => {
    const res = await request(app)
      .post('/diagrams')
      .set(VALID)
      .send({ diagram: { diagram_type: 'erd' } })
    expect(res.status).toBe(400)
  })

  it('201 y el INSERT escribe user_id EXPLÍCITO (la fila no existe → no hay RLS que lo ponga)', async () => {
    result = { data: { id: 'new-id', title: 'Blog' }, error: null }
    const res = await request(app)
      .post('/diagrams')
      .set(VALID)
      .send({ diagram: sampleDiagram, prompt: 'crea un blog' })
    expect(res.status).toBe(201)
    // El body lleva la metadata del diagrama + la versión inicial del diario.
    expect(res.body.id).toBe('new-id')
    expect(res.body.title).toBe('Blog')
    const inserted = calls.insert[0][0] as Record<string, unknown>
    expect(inserted.user_id).toBe('user-123')
    expect(inserted.prompt).toBe('crea un blog')
    expect(inserted.title).toBe('Blog')
  })

  it('rellena el título si llega null (fallback NOT NULL de 9.1)', async () => {
    result = { data: { id: 'x' }, error: null }
    await request(app)
      .post('/diagrams')
      .set(VALID)
      .send({ diagram: { ...sampleDiagram, title: null } })
    const inserted = calls.insert[0][0] as Record<string, unknown>
    expect(inserted.title).toBe('Diagrama sin título')
  })

  it('500 si la BD devuelve error', async () => {
    result = { data: null, error: { message: 'db down' } }
    const res = await request(app).post('/diagrams').set(VALID).send({ diagram: sampleDiagram })
    expect(res.status).toBe(500)
  })
})

describe('GET /diagrams (historial = metadata)', () => {
  beforeEach(authOk)

  it('devuelve solo metadata, ordenada updated_at desc, SIN filtrar por user_id (P2: confía en la RLS)', async () => {
    result = { data: [{ id: '1', title: 'A' }], error: null }
    const res = await request(app).get('/diagrams').set(VALID)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ id: '1', title: 'A' }])
    // Invariante de seguridad: el SELECT NO añade .eq('user_id', ...) — la RLS es
    // la única guardia. Un .eq redundante aquí sería señal de desconfianza en la RLS.
    expect(calls.eq).toBeUndefined()
    expect(calls.order[0]).toEqual(['updated_at', { ascending: false }])
    // Solo columnas de metadata, nunca `data` (carga diferida, P5).
    expect(calls.select[0][0]).not.toMatch(/data/)
  })
})

describe('GET /diagrams/:id (carga completa)', () => {
  beforeEach(authOk)

  it('404 si la RLS no devuelve fila (id ajeno → 0 filas, sin filtrar a mano)', async () => {
    result = { data: null, error: null }
    const res = await request(app).get('/diagrams/abc').set(VALID)
    expect(res.status).toBe(404)
    // Filtra por id, NO por user_id (la propiedad la impone la RLS).
    expect(calls.eq[0]).toEqual(['id', 'abc'])
    expect(calls.eq.every((c) => c[0] !== 'user_id')).toBe(true)
  })

  it('200 con la fila completa (incluye data) si existe', async () => {
    result = { data: { id: 'abc', data: sampleDiagram }, error: null }
    const res = await request(app).get('/diagrams/abc').set(VALID)
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(sampleDiagram)
  })
})

describe('PATCH /diagrams/:id (UPDATE)', () => {
  beforeEach(authOk)

  it('404 si la RLS bloquea el UPDATE de un diagrama ajeno (0 filas)', async () => {
    result = { data: null, error: null }
    const res = await request(app).patch('/diagrams/abc').set(VALID).send({ diagram: sampleDiagram })
    expect(res.status).toBe(404)
  })

  it('200 y filtra solo por id, nunca por user_id (P2)', async () => {
    result = { data: { id: 'abc', title: 'Blog' }, error: null }
    const res = await request(app).patch('/diagrams/abc').set(VALID).send({ diagram: sampleDiagram })
    expect(res.status).toBe(200)
    expect(calls.eq[0]).toEqual(['id', 'abc'])
    expect(calls.eq.every((c) => c[0] !== 'user_id')).toBe(true)
    // El UPDATE no reescribe user_id (la fila ya es del usuario; cambiarlo sería un secuestro).
    const updated = calls.update[0][0] as Record<string, unknown>
    expect(updated.user_id).toBeUndefined()
  })

  it('400 si el payload de update es inválido', async () => {
    const res = await request(app).patch('/diagrams/abc').set(VALID).send({ diagram: { title: 'x' } })
    expect(res.status).toBe(400)
  })

  it('el UPDATE nunca toca prompt: el original no se edita', async () => {
    result = { data: { id: 'abc', title: 'Blog' }, error: null }
    // Incluso si el cliente manda prompt en el PATCH, la columna se omite.
    await request(app).patch('/diagrams/abc').set(VALID).send({ diagram: sampleDiagram, prompt: 'otro' })
    const updated = calls.update[0][0] as Record<string, unknown>
    expect('prompt' in updated).toBe(false)
  })

  it('cada PATCH anota una versión en el diario', async () => {
    result = { data: { id: 'abc', title: 'Blog' }, error: null }
    await request(app)
      .patch('/diagrams/abc')
      .set(VALID)
      .send({ diagram: sampleDiagram, version: { origin: 'refine', instruction: 'añade Carrito' } })
    // El diagrama se modifica por UPDATE (calls.update); el único INSERT es la versión.
    const version = calls.insert[0][0] as Record<string, unknown>
    expect(version.diagram_id).toBe('abc')
    expect(version.user_id).toBe('user-123')
    expect(version.origin).toBe('refine')
    expect(version.instruction).toBe('añade Carrito')
  })

  it('sin `version` el guardado cae a origin manual_edit (edición a mano)', async () => {
    result = { data: { id: 'abc', title: 'Blog' }, error: null }
    await request(app).patch('/diagrams/abc').set(VALID).send({ diagram: sampleDiagram })
    const version = calls.insert[0][0] as Record<string, unknown>
    expect(version.origin).toBe('manual_edit')
  })
})

describe('diario de versiones (S10.3)', () => {
  beforeEach(authOk)

  it('GET /:id/versions lista metadata por seq, sin filtrar por user_id (RLS)', async () => {
    result = { data: [{ id: 'v1', seq: 1, origin: 'generate' }], error: null }
    const res = await request(app).get('/diagrams/abc/versions').set(VALID)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ id: 'v1', seq: 1, origin: 'generate' }])
    expect(calls.eq[0]).toEqual(['diagram_id', 'abc'])
    expect(calls.eq.every((c) => c[0] !== 'user_id')).toBe(true)
    expect(calls.order[0]).toEqual(['seq', { ascending: true }])
    // Metadata sin el snapshot pesado.
    expect(calls.select[0][0]).not.toMatch(/data/)
  })

  it('GET /:id/versions/:vid devuelve el snapshot completo (incluye data)', async () => {
    result = { data: { id: 'v1', seq: 1, data: sampleDiagram }, error: null }
    const res = await request(app).get('/diagrams/abc/versions/v1').set(VALID)
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(sampleDiagram)
    expect(calls.eq[0]).toEqual(['id', 'v1'])
    expect(calls.eq[1]).toEqual(['diagram_id', 'abc'])
  })

  it('404 si la versión no existe (RLS → 0 filas)', async () => {
    result = { data: null, error: null }
    const res = await request(app).get('/diagrams/abc/versions/zzz').set(VALID)
    expect(res.status).toBe(404)
  })
})
