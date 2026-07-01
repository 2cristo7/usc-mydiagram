import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Complementa useWebSocket.test.ts y useWebSocketAuth.test.ts cubriendo los caminos
// PROFUNDOS del hook: la cola de revelado en vivo (enqueueLiveNode/edge → runLivePump
// → finalizeGeneration → processDone) y el proxy llm:request (fetch a Ollama). Se usan
// timers falsos para drenar la bomba y un mock de fetch para el proxy.

const h = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const ioHandlers = new Map<string, (...args: unknown[]) => void>()
  const fakeSocket = {
    connected: true,
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => { handlers.set(event, cb) }),
    emit: vi.fn(),
    disconnect: vi.fn(),
    io: {
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => { ioHandlers.set(event, cb) }),
      off: vi.fn(),
    },
  }
  // currentDiagram mutable: runLivePump lee getState().currentDiagram?.nodes para
  // saber qué hay ya en el canvas. addNode/addEdge lo actualizan.
  const canvas = { nodes: [] as { id: string }[], edges: [] as { id: string }[] }
  const storeState = {
    currentDiagram: canvas as unknown as { nodes: { id: string }[] } | null,
    uiState: 'idle' as string,
    generationPhase: 'idle' as string,
    setCurrentDiagramId: vi.fn(),
    setLastGenerationPrompt: vi.fn(),
    setLastGenerationType: vi.fn(),
    selectedDiagramType: null,
    setPromptDraft: vi.fn(),
    setUiState: vi.fn((s: string) => { storeState.uiState = s }),
    setActiveOperation: vi.fn(),
    __promptDraft: '' as string,
  }
  const storeActions = {
    addNode: vi.fn((n: { id: string; label?: string }) => { canvas.nodes.push({ id: n.id }) }),
    addEdge: vi.fn((e: { id: string }) => { canvas.edges.push({ id: e.id }) }),
    setUiState: storeState.setUiState,
    setPendingClarification: vi.fn(), updateNode: vi.fn(), removeNode: vi.fn(),
    removeEdge: vi.fn(), applyDiagram: vi.fn(), traceToolCall: vi.fn(),
    traceToolResult: vi.fn(), clearToolTrace: vi.fn(), pushLiveOp: vi.fn(),
    clearLiveOps: vi.fn(), setGenerationPhase: vi.fn(), clearDiagramContent: vi.fn(),
    setPendingTypeChoice: vi.fn(), addVersion: vi.fn(),
    setActiveOperation: storeState.setActiveOperation, setStreamingType: vi.fn(),
  }
  const uiState = { setGenerationError: vi.fn(), focusPrompt: vi.fn() }
  const llmState = {
    setOllamaError: vi.fn(),
    registerTransientEmitter: vi.fn(),
    registerLocalConfigEmitter: vi.fn(),
  }
  return {
    handlers, ioHandlers, fakeSocket, storeState, storeActions, uiState, llmState, canvas,
    toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
    signOut: vi.fn(),
    persistResult: { ok: true, version: { seq: 1, id: 'v1', origin: 'generate' } } as Record<string, unknown>,
    persist: vi.fn(),
    useStore: Object.assign(() => storeActions, {
      getState: () => ({ ...storeState, ...storeActions, currentDiagram: storeState.currentDiagram, promptDrafts: {} }),
    }),
    selectPromptDraft: () => storeState.__promptDraft ?? '',
    useAuthStore: Object.assign(
      (selector: (s: unknown) => unknown) => selector({ user: { id: 'u1' }, session: { access_token: 'tok' } }),
      { getState: () => ({ session: { access_token: 'tok' } }) },
    ),
    useUiStore: { getState: () => uiState },
    useLlmSettingsStore: { getState: () => llmState },
  }
})

vi.mock('socket.io-client', () => ({ io: vi.fn(() => h.fakeSocket), Socket: class {} }))
vi.mock('../lib/supabase', () => ({
  supabase: { auth: { onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })) } },
}))
vi.mock('../hooks/useAuth', () => ({ signOut: h.signOut }))
vi.mock('../store/index', () => ({ useStore: h.useStore, selectPromptDraft: h.selectPromptDraft }))
vi.mock('../store/auth', () => ({ useAuthStore: h.useAuthStore }))
vi.mock('../store/ui', () => ({ useUiStore: h.useUiStore }))
vi.mock('../store/llmSettings', () => ({ useLlmSettingsStore: h.useLlmSettingsStore }))
vi.mock('../lib/api', () => ({ persistCurrentDiagram: (...a: unknown[]) => h.persist(...a) }))
vi.mock('../store/toast', () => ({ toast: h.toast }))
vi.mock('../ui/utils/diagramToJson', () => ({ diagramToJson: vi.fn(() => ({})) }))
vi.mock('../lib/transientLlmKey', () => ({ readTransientKey: vi.fn(() => null) }))
vi.mock('../lib/localLlmConfig', () => ({ readLocalConfig: vi.fn(() => null) }))

import { useWebSocket } from '../hooks/useWebSocket'

beforeEach(() => {
  vi.clearAllMocks()
  h.handlers.clear()
  h.ioHandlers.clear()
  h.fakeSocket.connected = true
  h.storeState.currentDiagram = h.canvas
  h.storeState.uiState = 'idle'
  h.storeState.generationPhase = 'idle'
  h.storeState.__promptDraft = ''
  h.canvas.nodes = []
  h.canvas.edges = []
  h.persist.mockResolvedValue(h.persistResult)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
})

// Pone el hook en "montaje en vivo activo" arrancando una generación desde cero.
async function startGeneration() {
  h.canvas.nodes = []
  h.canvas.edges = []
  h.storeState.currentDiagram = h.canvas // no-null pero vacío
  // sendMessage con currentDiagram vacío de nodos sigue siendo "refinamiento" porque
  // currentDiagram != null. Para forzar generación desde cero, lo ponemos a null.
  h.storeState.currentDiagram = null as never
  const hook = renderHook(() => useWebSocket())
  await act(async () => { await hook.result.current.sendMessage('crea un ERD') })
  // Tras sendMessage el canvas vuelve a sembrarse por addNode. Reapuntamos.
  h.storeState.currentDiagram = h.canvas
  return hook
}

describe('useWebSocket — cola de revelado en vivo', () => {
  it('los nodos encolados se revelan uno a uno con el ritmo de la bomba', async () => {
    vi.useFakeTimers()
    await startGeneration()
    act(() => { h.handlers.get('diagram:node_ready')!({ id: 'n1', label: 'A' }) })
    act(() => { h.handlers.get('diagram:node_ready')!({ id: 'n2', label: 'B' }) })
    // La bomba programa el primer tick a LIVE_MIN_STEP (45 ms).
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(h.storeActions.addNode).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(h.storeActions.addNode).toHaveBeenCalledTimes(2)
    expect(h.storeActions.pushLiveOp).toHaveBeenCalled()
  })

  it('una arista espera a que sus dos nodos estén en el canvas antes de revelarse', async () => {
    vi.useFakeTimers()
    await startGeneration()
    // La arista llega ANTES que sus nodos.
    act(() => { h.handlers.get('diagram:edge_ready')!({ id: 'e1', source: 'n1', target: 'n2' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(60) })
    // No revelable todavía (ningún nodo): addEdge no se llama.
    expect(h.storeActions.addEdge).not.toHaveBeenCalled()
    // Llegan los nodos.
    act(() => { h.handlers.get('diagram:node_ready')!({ id: 'n1', label: 'A' }) })
    act(() => { h.handlers.get('diagram:node_ready')!({ id: 'n2', label: 'B' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(h.storeActions.addEdge).toHaveBeenCalledTimes(1)
  })

  it('diagram:done durante el montaje aplaza el desenlace hasta vaciar la cola', async () => {
    vi.useFakeTimers()
    await startGeneration()
    act(() => { h.handlers.get('diagram:node_ready')!({ id: 'n1', label: 'A' }) })
    // done mientras quedan elementos por revelar → se aplaza (pendingDone).
    act(() => {
      h.handlers.get('diagram:done')!({
        diagram: { diagram_type: 'erd', nodes: [], edges: [] },
        title: 'T',
      })
    })
    // applyDiagram aún no debe haberse llamado (la bomba no ha drenado).
    expect(h.storeActions.applyDiagram).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    // Drenada la cola → finalizeGeneration → processDone → applyDiagram.
    expect(h.storeActions.applyDiagram).toHaveBeenCalled()
  })

  it('done con snapshot inválido fija error y no aplica el diagrama', async () => {
    h.storeState.currentDiagram = h.canvas
    renderHook(() => useWebSocket())
    act(() => {
      // Sin montaje en vivo activo (no se llamó sendMessage) → processDone directo.
      h.handlers.get('diagram:done')!({ diagram: { diagram_type: 'no-existe', nodes: 'x' } })
    })
    expect(h.uiState.setGenerationError).toHaveBeenCalledWith('El diagrama recibido no es válido.')
    expect(h.storeActions.applyDiagram).not.toHaveBeenCalled()
  })
})

describe('useWebSocket — proxy llm:request (Ollama)', () => {
  it('completion correcta emite llm:response con el content', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ message: { content: 'hola mundo' } }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    renderHook(() => useWebSocket())
    await act(async () => {
      await h.handlers.get('llm:request')!({
        request_id: 'r1', model: 'qwen3:1.7b', messages: [{ role: 'user', content: 'hi' }],
      })
    })
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:11434/api/chat', expect.objectContaining({ method: 'POST' }))
    expect(h.fakeSocket.emit).toHaveBeenCalledWith('llm:response', { request_id: 'r1', content: 'hola mundo' })
    expect(h.llmState.setOllamaError).toHaveBeenCalledWith(null)
    vi.unstubAllGlobals()
  })

  it('limpia el bloque <think>…</think> del content si el modelo lo emite', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ message: { content: '<think>razonando</think>RESPUESTA' } }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    renderHook(() => useWebSocket())
    await act(async () => {
      await h.handlers.get('llm:request')!({ request_id: 'r2', model: 'm', messages: [] })
    })
    const respCall = h.fakeSocket.emit.mock.calls.find((c) => c[0] === 'llm:response')
    expect((respCall![1] as { content: string }).content).toBe('RESPUESTA')
    vi.unstubAllGlobals()
  })

  it('HTTP 404 mapea a model_missing y emite llm:error', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)
    renderHook(() => useWebSocket())
    await act(async () => {
      await h.handlers.get('llm:request')!({ request_id: 'r3', model: 'falta', messages: [] })
    })
    const errCall = h.fakeSocket.emit.mock.calls.find((c) => c[0] === 'llm:error')
    expect((errCall![1] as { error_code: string }).error_code).toBe('model_missing')
    expect(h.llmState.setOllamaError).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('HTTP 500 mapea a unknown', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)
    renderHook(() => useWebSocket())
    await act(async () => {
      await h.handlers.get('llm:request')!({ request_id: 'r4', model: 'm', messages: [] })
    })
    const errCall = h.fakeSocket.emit.mock.calls.find((c) => c[0] === 'llm:error')
    expect((errCall![1] as { error_code: string }).error_code).toBe('unknown')
    vi.unstubAllGlobals()
  })

  it('fetch rechazado (Ollama inalcanzable) emite ollama_unreachable', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    vi.stubGlobal('fetch', fetchMock)
    renderHook(() => useWebSocket())
    await act(async () => {
      await h.handlers.get('llm:request')!({ request_id: 'r5', model: 'm', messages: [] })
    })
    const errCall = h.fakeSocket.emit.mock.calls.find((c) => c[0] === 'llm:error')
    expect((errCall![1] as { error_code: string }).error_code).toBe('ollama_unreachable')
    vi.unstubAllGlobals()
  })

  it('aborto por timeout produce ollama_unreachable con detalle de sobrecarga', async () => {
    const fetchMock = vi.fn(async () => {
      const e = new DOMException('aborted', 'AbortError')
      throw e
    })
    vi.stubGlobal('fetch', fetchMock)
    renderHook(() => useWebSocket())
    await act(async () => {
      await h.handlers.get('llm:request')!({ request_id: 'r6', model: 'm', messages: [] })
    })
    const errCall = h.fakeSocket.emit.mock.calls.find((c) => c[0] === 'llm:error')
    expect((errCall![1] as { error_code: string }).error_code).toBe('ollama_unreachable')
    expect((errCall![1] as { detail: string }).detail).toContain('no respondió')
    vi.unstubAllGlobals()
  })
})

describe('useWebSocket — deltas del agente (refinamiento)', () => {
  it('agent:tool_result add_node aplica el delta y traza ok', () => {
    renderHook(() => useWebSocket())
    act(() => {
      h.handlers.get('agent:tool_result')!({
        id: 't1', tool: 'add_node', node: { id: 'n1', label: 'Carrito' }, result: {},
      })
    })
    expect(h.storeActions.addNode).toHaveBeenCalledWith({ id: 'n1', label: 'Carrito' })
    expect(h.storeActions.traceToolResult).toHaveBeenCalledWith('t1', 'ok')
  })

  it('agent:tool_result delete_edge elimina la arista', () => {
    renderHook(() => useWebSocket())
    act(() => {
      h.handlers.get('agent:tool_result')!({ id: 't2', tool: 'delete_edge', result: { deleted_edge: 'e9' } })
    })
    expect(h.storeActions.removeEdge).toHaveBeenCalledWith('e9')
  })

  it('agent:tool_result con error avisa con warning y traza error', () => {
    renderHook(() => useWebSocket())
    act(() => {
      h.handlers.get('agent:tool_result')!({ id: 't3', tool: 'add_node', result: { error: 'boom' } })
    })
    expect(h.toast.warning).toHaveBeenCalled()
    expect(h.storeActions.traceToolResult).toHaveBeenCalledWith('t3', 'error')
  })

  it('agent:tool_call registra la llamada en la traza', () => {
    renderHook(() => useWebSocket())
    act(() => {
      h.handlers.get('agent:tool_call')!({ id: 'c1', tool: 'add_node', args: { label: 'X' } })
    })
    expect(h.storeActions.traceToolCall).toHaveBeenCalledWith({ id: 'c1', tool: 'add_node', args: { label: 'X' } })
  })
})

describe('useWebSocket — clarificación de tipo y degradación', () => {
  it('diagram:type_clarification deja a la espera de elección', () => {
    renderHook(() => useWebSocket())
    act(() => {
      h.handlers.get('diagram:type_clarification')!({ question: '¿tipo?', options: [{ label: 'ERD', value: 'erd' }] })
    })
    expect(h.storeActions.setPendingTypeChoice).toHaveBeenCalled()
    expect(h.storeState.setUiState).toHaveBeenCalledWith('awaiting_clarification')
  })

  it('done con degradación parcial emite avisos por categoría', async () => {
    h.storeState.currentDiagram = h.canvas
    renderHook(() => useWebSocket())
    act(() => {
      h.handlers.get('diagram:done')!({
        diagram: { diagram_type: 'erd', nodes: [], edges: [] },
        title: 'T',
        degraded: true,
        degradations: [{ category: 'edges', reasons: ['x'] }],
      })
    })
    await act(async () => { await Promise.resolve() })
    expect(h.toast.warning).toHaveBeenCalled()
  })
})

describe('useWebSocket — auth:expired', () => {
  it('cierra sesión y marca error', () => {
    renderHook(() => useWebSocket())
    act(() => { h.handlers.get('auth:expired')!() })
    expect(h.toast.error).toHaveBeenCalled()
    expect(h.signOut).toHaveBeenCalled()
    expect(h.storeState.setUiState).toHaveBeenCalledWith('error')
  })
})
