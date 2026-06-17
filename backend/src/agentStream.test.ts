import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { streamAgentToSocket, type SocketLike } from './agentStream'

// ── Dobles ──────────────────────────────────────────────────────────────────
// El socket solo necesita .emit (interfaz mínima, ver SocketLike): un objeto
// literal que acumula los emits basta. Para fetch NO se mockea la lectura: se
// stubea el global devolviendo una Response REAL sobre un ReadableStream cuyos
// chunks controla el test → getReader() + TextDecoder ejecutan su código real,
// que es justo lo que se quiere probar (buffering, multibyte, líneas partidas).

function fakeSocket() {
  const emits: Array<{ event: string; payload: unknown }> = []
  const socket: SocketLike = { emit: (event, payload) => emits.push({ event, payload }) }
  return { socket, emits }
}

function stubFetchWithChunks(chunks: Array<string | Uint8Array>) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(typeof c === 'string' ? encoder.encode(c) : c)
      controller.close()
    },
  })
  const fetchSpy = vi.fn(async () => new Response(stream))
  vi.stubGlobal('fetch', fetchSpy)
  return fetchSpy
}

function line(obj: object): string {
  return JSON.stringify(obj) + '\n'
}

beforeEach(() => {
  // Silenciar los console.log de transmisión del gateway en la salida de tests
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ── Petición saliente ───────────────────────────────────────────────────────

test('reenvía el body como JSON POST a la URL del agente', async () => {
  const fetchSpy = stubFetchWithChunks([])
  const { socket } = fakeSocket()
  await streamAgentToSocket('http://agent/refine/stream', { prompt: 'hola' }, socket)

  // objectContaining: además de method/headers/body, el fetch lleva ahora un
  // `signal` (AbortController para el timeout de inactividad); no lo fijamos aquí.
  expect(fetchSpy).toHaveBeenCalledWith('http://agent/refine/stream', expect.objectContaining({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'hola' }),
  }))
})

// ── Mapeo _type → evento Socket.io ──────────────────────────────────────────

describe('mapeo de eventos NDJSON', () => {
  test('node → diagram:node_ready con el data desempaquetado', async () => {
    const node = { id: 'usuario', node_type: 'table', label: 'Usuario' }
    stubFetchWithChunks([line({ _type: 'node', data: node })])
    const { socket, emits } = fakeSocket()
    await streamAgentToSocket('http://agent', {}, socket)

    expect(emits).toEqual([{ event: 'diagram:node_ready', payload: node }])
  })

  test('edge → diagram:edge_ready', async () => {
    const edge = { id: 'e1', source: 'a', target: 'b', edge_type: 'one_to_many' }
    stubFetchWithChunks([line({ _type: 'edge', data: edge })])
    const { socket, emits } = fakeSocket()
    await streamAgentToSocket('http://agent', {}, socket)

    expect(emits).toEqual([{ event: 'diagram:edge_ready', payload: edge }])
  })

  test('done mínimo (generación) → defaults: no degradado, historia vacía, diagram null', async () => {
    stubFetchWithChunks([line({ _type: 'done', title: 'ERD tienda' })])
    const { socket, emits } = fakeSocket()
    await streamAgentToSocket('http://agent', {}, socket)

    expect(emits).toEqual([{
      event: 'diagram:done',
      payload: { title: 'ERD tienda', degraded: false, degradations: [], refinement_history: [], diagram: null },
    }])
  })

  test('done completo (refinamiento) → passthrough de snapshot, historia y degradación', async () => {
    const diagram = { diagram_type: 'erd', nodes: [{ id: 'n1' }], edges: [] }
    const history = [{ tool: 'add_node', args: { label: 'Carrito' }, result: { id: 'carrito' } }]
    const degradations = [{ category: 'edges', reasons: ['huérfana e7'] }]
    stubFetchWithChunks([line({ _type: 'done', title: null, degraded: true, degradations, refinement_history: history, diagram })])
    const { socket, emits } = fakeSocket()
    await streamAgentToSocket('http://agent', {}, socket)

    expect(emits).toEqual([{
      event: 'diagram:done',
      payload: { title: null, degraded: true, degradations, refinement_history: history, diagram },
    }])
  })

  test('tool_call → agent:tool_call con args default {}', async () => {
    stubFetchWithChunks([
      line({ _type: 'tool_call', id: 'c1', tool: 'apply_layout' }),
      line({ _type: 'tool_call', id: 'c2', tool: 'find_node', args: { query: 'Usuarios' } }),
    ])
    const { socket, emits } = fakeSocket()
    await streamAgentToSocket('http://agent', {}, socket)

    expect(emits).toEqual([
      { event: 'agent:tool_call', payload: { id: 'c1', tool: 'apply_layout', args: {} } },
      { event: 'agent:tool_call', payload: { id: 'c2', tool: 'find_node', args: { query: 'Usuarios' } } },
    ])
  })

  test('tool_result → agent:tool_result con el delta declarado (node/edge) tal cual', async () => {
    const node = { id: 'carrito', node_type: 'table', label: 'Carrito' }
    stubFetchWithChunks([line({ _type: 'tool_result', id: 'c1', tool: 'add_node', result: { id: 'carrito' }, node })])
    const { socket, emits } = fakeSocket()
    await streamAgentToSocket('http://agent', {}, socket)

    expect(emits).toEqual([{
      event: 'agent:tool_result',
      payload: { id: 'c1', tool: 'add_node', result: { id: 'carrito' }, node, edge: undefined },
    }])
  })

  test('clarification → agent:clarification con options default []', async () => {
    stubFetchWithChunks([line({ _type: 'clarification', thread_id: 't1', question: '¿ERD o UML?' })])
    const { socket, emits } = fakeSocket()
    await streamAgentToSocket('http://agent', {}, socket)

    expect(emits).toEqual([{
      event: 'agent:clarification',
      payload: { thread_id: 't1', question: '¿ERD o UML?', options: [] },
    }])
  })

  test('error → diagram:error con mensaje accionable y categoría', async () => {
    stubFetchWithChunks([line({ _type: 'error', category: 'not_a_diagram', message: 'Describe un sistema…' })])
    const { socket, emits } = fakeSocket()
    await streamAgentToSocket('http://agent', {}, socket)

    expect(emits).toEqual([{
      event: 'diagram:error',
      payload: { error: 'Describe un sistema…', category: 'not_a_diagram' },
    }])
  })

  test('un {"detail": …} de un 422 → emite diagram:error (validation_error) una sola vez y no rompe el stream', async () => {
    stubFetchWithChunks([
      line({ detail: [{ msg: 'field required' }] }),
      line({ detail: [{ msg: 'otro' }] }),
      line({ _type: 'node', data: { id: 'a' } }),
    ])
    const { socket, emits } = fakeSocket()
    await streamAgentToSocket('http://agent', {}, socket)

    // El primer {detail} (shape de error de validación FastAPI) se traduce a un
    // diagram:error accionable; el segundo NO re-emite (flag de una vez por stream);
    // el stream continúa y el node posterior se emite con normalidad.
    expect(emits).toEqual([
      { event: 'diagram:error', payload: { error: 'La petición no es válida.', category: 'validation_error' } },
      { event: 'diagram:node_ready', payload: { id: 'a' } },
    ])
  })
})

// ── Buffering: las fronteras de chunk son arbitrarias ───────────────────────

describe('buffering de chunks', () => {
  test('una línea JSON partida entre dos chunks se reensambla', async () => {
    const full = line({ _type: 'node', data: { id: 'usuario', label: 'Usuario' } })
    const cut = Math.floor(full.length / 2)
    stubFetchWithChunks([full.slice(0, cut), full.slice(cut)])
    const { socket, emits } = fakeSocket()
    await streamAgentToSocket('http://agent', {}, socket)

    expect(emits).toEqual([{ event: 'diagram:node_ready', payload: { id: 'usuario', label: 'Usuario' } }])
  })

  test('varios eventos en un mismo chunk se emiten todos y en orden', async () => {
    stubFetchWithChunks([
      line({ _type: 'node', data: { id: 'a' } }) + line({ _type: 'node', data: { id: 'b' } }) + line({ _type: 'edge', data: { id: 'e1' } }),
    ])
    const { socket, emits } = fakeSocket()
    await streamAgentToSocket('http://agent', {}, socket)

    expect(emits.map((e) => e.event)).toEqual(['diagram:node_ready', 'diagram:node_ready', 'diagram:edge_ready'])
    expect(emits.map((e) => (e.payload as { id: string }).id)).toEqual(['a', 'b', 'e1'])
  })

  test('UTF-8 multibyte cortado entre chunks NO corrompe el texto (pendientes: riesgo S4)', async () => {
    // El emoji 💡 ocupa 4 bytes en UTF-8. Se corta el stream en mitad de esos
    // 4 bytes: sin { stream: true } en TextDecoder, el primer decode emitiría
    // U+FFFD y el JSON.parse de la línea fallaría. Con él, el decoder retiene
    // los bytes incompletos hasta el siguiente chunk.
    const full = new TextEncoder().encode(line({ _type: 'node', data: { id: 'cafe', label: 'Café 💡' } }))
    const emojiStart = full.length - 1 - 4 // …💡"}}\n → cortar dentro del emoji
    const cut = emojiStart + 2
    stubFetchWithChunks([full.slice(0, cut), full.slice(cut)])
    const { socket, emits } = fakeSocket()
    await streamAgentToSocket('http://agent', {}, socket)

    expect(emits).toEqual([{ event: 'diagram:node_ready', payload: { id: 'cafe', label: 'Café 💡' } }])
  })

  test('líneas en blanco entre eventos se ignoran', async () => {
    stubFetchWithChunks(['\n\n' + line({ _type: 'node', data: { id: 'a' } }) + '\n'])
    const { socket, emits } = fakeSocket()
    await streamAgentToSocket('http://agent', {}, socket)

    expect(emits).toHaveLength(1)
  })

  test('CONTRATO: un fragmento final sin \\n se descarta — el agente termina toda línea con \\n', async () => {
    // Documenta el comportamiento del buffer: lo que queda sin \n al cerrar el
    // stream nunca se parsea. Es correcto PORQUE el agente (main.py) hace
    // json.dumps(...) + "\n" en cada yield; si ese contrato se rompiera, el
    // último evento (típicamente el done) se perdería en silencio.
    stubFetchWithChunks([line({ _type: 'node', data: { id: 'a' } }) + '{"_type":"done","title":"sin newline"}'])
    const { socket, emits } = fakeSocket()
    await streamAgentToSocket('http://agent', {}, socket)

    expect(emits).toEqual([{ event: 'diagram:node_ready', payload: { id: 'a' } }])
  })
})

// ── Resiliencia ─────────────────────────────────────────────────────────────

describe('resiliencia', () => {
  test('una línea NDJSON inválida se ignora y el resto del stream continúa', async () => {
    stubFetchWithChunks([
      line({ _type: 'node', data: { id: 'a' } }) + '{esto no es json}\n' + line({ _type: 'done', title: 't' }),
    ])
    const { socket, emits } = fakeSocket()
    await streamAgentToSocket('http://agent', {}, socket)

    expect(emits.map((e) => e.event)).toEqual(['diagram:node_ready', 'diagram:done'])
  })

  test('fallo de red (agente caído) → diagram:error con mensaje genérico, sin excepción', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    const { socket, emits } = fakeSocket()
    await streamAgentToSocket('http://agent', {}, socket)

    expect(emits).toEqual([{ event: 'diagram:error', payload: { error: 'Error generando el diagrama' } }])
  })
})
