import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Tests del ciclo de conexión y del flujo de envío de useWebSocket. Complementa a
// useWebSocketAuth.test.ts (que cubre el endurecimiento JWT): aquí se ejercitan los
// handlers de conexión (connect / disconnect / connect_error) y sendMessage.
//
// Todo lo que los factories de vi.mock necesitan vive en `h` (hoisted).
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
  const storeState = {
    currentDiagram: null as unknown,
    uiState: 'idle' as string,
    generationPhase: 'idle' as string,
    setCurrentDiagramId: vi.fn(),
    setLastGenerationPrompt: vi.fn(),
    setLastGenerationType: vi.fn(),
    selectedDiagramType: null,
    setPromptDraft: vi.fn(),
    setUiState: vi.fn(),
    setActiveOperation: vi.fn(),
  }
  const storeActions = {
    addNode: vi.fn(), addEdge: vi.fn(), setUiState: storeState.setUiState,
    setPendingClarification: vi.fn(), updateNode: vi.fn(), removeNode: vi.fn(),
    removeEdge: vi.fn(), applyDiagram: vi.fn(), traceToolCall: vi.fn(),
    traceToolResult: vi.fn(), clearToolTrace: vi.fn(), pushLiveOp: vi.fn(),
    clearLiveOps: vi.fn(), setGenerationPhase: vi.fn(), clearDiagramContent: vi.fn(),
    setPendingTypeChoice: vi.fn(), addVersion: vi.fn(),
    setActiveOperation: storeState.setActiveOperation, setStreamingType: vi.fn(),
  }
  const uiState = {
    setGenerationError: vi.fn(), focusPrompt: vi.fn(),
  }
  const llmState = {
    setOllamaError: vi.fn(),
    registerTransientEmitter: vi.fn(),
    registerLocalConfigEmitter: vi.fn(),
  }
  return {
    handlers, ioHandlers, fakeSocket, storeState, uiState, llmState,
    toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
    signOut: vi.fn(),
    useStore: Object.assign(() => storeActions, {
      getState: () => ({ ...storeState, ...storeActions, promptDrafts: {} }),
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
  supabase: {
    auth: {
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
}))
vi.mock('../hooks/useAuth', () => ({ signOut: h.signOut }))
vi.mock('../store/index', () => ({ useStore: h.useStore, selectPromptDraft: h.selectPromptDraft }))
vi.mock('../store/auth', () => ({ useAuthStore: h.useAuthStore }))
vi.mock('../store/ui', () => ({ useUiStore: h.useUiStore }))
vi.mock('../store/llmSettings', () => ({ useLlmSettingsStore: h.useLlmSettingsStore }))
vi.mock('../lib/api', () => ({ persistCurrentDiagram: vi.fn(async () => ({ ok: true })) }))
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
  h.storeState.currentDiagram = null
  h.storeState.uiState = 'idle'
  h.storeState.generationPhase = 'idle'
  // @ts-expect-error campo auxiliar de test
  h.storeState.__promptDraft = ''
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('useWebSocket — ciclo de conexión', () => {
  it('registra los handlers de socket esperados al montar', () => {
    renderHook(() => useWebSocket())
    for (const ev of ['connect', 'disconnect', 'connect_error', 'diagram:done', 'diagram:error', 'diagram:node_ready']) {
      expect(h.handlers.has(ev)).toBe(true)
    }
  })

  it('connect → estado "connected" y registra emisores transitorios', () => {
    const { result } = renderHook(() => useWebSocket())
    expect(result.current.connectionState).toBe('connecting')
    act(() => { h.handlers.get('connect')!() })
    expect(result.current.connectionState).toBe('connected')
    expect(h.llmState.registerTransientEmitter).toHaveBeenCalled()
    expect(h.llmState.registerLocalConfigEmitter).toHaveBeenCalled()
  })

  it('connect saca el uiState de "error" (auto-recuperación)', () => {
    h.storeState.uiState = 'error'
    renderHook(() => useWebSocket())
    act(() => { h.handlers.get('connect')!() })
    expect(h.storeState.setUiState).toHaveBeenCalledWith('idle')
  })

  it('connect_error → estado "error", uiState error y un único toast', () => {
    const { result } = renderHook(() => useWebSocket())
    act(() => { h.handlers.get('connect_error')!(new Error('boom')) })
    expect(result.current.connectionState).toBe('error')
    expect(h.storeState.setUiState).toHaveBeenCalledWith('error')
    expect(h.toast.error).toHaveBeenCalledWith('No se pudo conectar con el servidor.')
    // Segundo fallo en la misma racha: no spamea otro toast.
    h.toast.error.mockClear()
    act(() => { h.handlers.get('connect_error')!(new Error('boom2')) })
    expect(h.toast.error).not.toHaveBeenCalled()
  })

  it('disconnect del propio cliente (io client disconnect) no avisa ni marca error', () => {
    renderHook(() => useWebSocket())
    act(() => { h.handlers.get('disconnect')!('io client disconnect') })
    expect(h.toast.error).not.toHaveBeenCalled()
    expect(h.storeState.setUiState).not.toHaveBeenCalledWith('error')
  })

  it('disconnect en reposo (generationPhase idle) no ensucia el chat', () => {
    h.storeState.generationPhase = 'idle'
    renderHook(() => useWebSocket())
    act(() => { h.handlers.get('disconnect')!('transport close') })
    expect(h.toast.error).not.toHaveBeenCalled()
  })

  it('disconnect durante una generación avisa y deja uiState en error', () => {
    h.storeState.generationPhase = 'live'
    renderHook(() => useWebSocket())
    act(() => { h.handlers.get('disconnect')!('transport close') })
    expect(h.toast.error).toHaveBeenCalledWith('Conexión perdida durante la generación. Inténtalo de nuevo.')
    expect(h.storeState.setUiState).toHaveBeenCalledWith('error')
  })
})

describe('useWebSocket — reconexión (Manager)', () => {
  it('reconnect_attempt → estado "reconnecting"', () => {
    const { result } = renderHook(() => useWebSocket())
    act(() => { h.ioHandlers.get('reconnect_attempt')!() })
    expect(result.current.connectionState).toBe('reconnecting')
  })

  it('reconnect_failed → estado "error" y toast', () => {
    const { result } = renderHook(() => useWebSocket())
    act(() => { h.ioHandlers.get('reconnect_failed')!() })
    expect(result.current.connectionState).toBe('error')
    expect(h.toast.error).toHaveBeenCalledWith('No se pudo reconectar con el servidor.')
  })

  it('connect_error durante el ciclo de reconexión mantiene "reconnecting"', () => {
    const { result } = renderHook(() => useWebSocket())
    act(() => { h.ioHandlers.get('reconnect_attempt')!() })
    h.toast.error.mockClear()
    act(() => { h.handlers.get('connect_error')!(new Error('x')) })
    expect(result.current.connectionState).toBe('reconnecting')
    expect(h.toast.error).not.toHaveBeenCalled()
  })
})

describe('useWebSocket — sendMessage', () => {
  it('ignora texto vacío', async () => {
    const { result } = renderHook(() => useWebSocket())
    await act(async () => { await result.current.sendMessage('   ') })
    expect(h.fakeSocket.emit).not.toHaveBeenCalledWith('message:send', expect.anything())
  })

  it('sin conexión avisa y limpia la operación activa', async () => {
    h.fakeSocket.connected = false
    const { result } = renderHook(() => useWebSocket())
    await act(async () => { await result.current.sendMessage('hola') })
    expect(h.toast.error).toHaveBeenCalledWith('Sin conexión con el servidor. Reintenta en unos segundos.')
    expect(h.storeState.setActiveOperation).toHaveBeenCalledWith(null)
  })

  it('sin diagrama emite message:send (generación desde cero)', async () => {
    const { result } = renderHook(() => useWebSocket())
    await act(async () => { await result.current.sendMessage('crea un ERD') })
    expect(h.fakeSocket.emit).toHaveBeenCalledWith('message:send', expect.objectContaining({ prompt: 'crea un ERD' }))
    expect(h.storeState.setCurrentDiagramId).toHaveBeenCalledWith(null)
  })

  it('con diagrama existente emite message:refine (refinamiento)', async () => {
    h.storeState.currentDiagram = { nodes: [], edges: [], title: 't', diagram_type: 'erd' }
    const { result } = renderHook(() => useWebSocket())
    await act(async () => { await result.current.sendMessage('añade Carrito') })
    expect(h.fakeSocket.emit).toHaveBeenCalledWith('message:refine', expect.objectContaining({ prompt: 'añade Carrito' }))
  })
})

describe('useWebSocket — desenlaces del agente', () => {
  it('diagram:error de LLM fija el banner de error y vuelve a idle', () => {
    renderHook(() => useWebSocket())
    act(() => {
      h.handlers.get('diagram:error')!({ category: 'llm_error', error: 'modelo caído', provider: 'openai' })
    })
    expect(h.llmState.setOllamaError).toHaveBeenCalled()
    expect(h.storeState.setUiState).toHaveBeenCalledWith('error')
  })

  it('diagram:error genérico fija el mensaje en el banner del canvas', () => {
    renderHook(() => useWebSocket())
    act(() => { h.handlers.get('diagram:error')!({ error: 'algo falló' }) })
    expect(h.uiState.setGenerationError).toHaveBeenCalledWith('algo falló')
    expect(h.storeState.setUiState).toHaveBeenCalledWith('error')
  })

  it('agent:clarification deja el estado a la espera de respuesta', () => {
    renderHook(() => useWebSocket())
    act(() => {
      h.handlers.get('agent:clarification')!({ thread_id: 'th1', question: '¿qué?', options: ['a', 'b'] })
    })
    expect(h.storeState.setUiState).toHaveBeenCalledWith('awaiting_clarification')
  })
})

describe('useWebSocket — limpieza', () => {
  it('al desmontar desconecta el socket y suelta los listeners del Manager', () => {
    const { unmount } = renderHook(() => useWebSocket())
    unmount()
    expect(h.fakeSocket.disconnect).toHaveBeenCalled()
    expect(h.fakeSocket.io.off).toHaveBeenCalledWith('reconnect_attempt')
  })
})
