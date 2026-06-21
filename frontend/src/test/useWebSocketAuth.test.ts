import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// S10.1 — Lado frontend del endurecimiento JWT en el socket:
//   - al recibir `auth:expired` (el backend cortó por token caducado/anomalía):
//     avisa en el chat y desloguea (signOut).
//   - al refrescar supabase-js el token (evento TOKEN_REFRESHED): reenvía el
//     token nuevo al socket vivo con `auth:refresh`, sin recrear la conexión.

// Todo lo que los factories de vi.mock necesitan vive en `h` (hoisted) para no
// chocar con el hoisting de vi.mock al inicio del archivo.
const h = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const fakeSocket = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => { handlers.set(event, cb) }),
    emit: vi.fn(),
    disconnect: vi.fn(),
  }
  const store = { setActiveOperation: vi.fn(), setUiState: vi.fn() }
  const toast = { error: vi.fn(), warning: vi.fn() }
  const storeActions = {
    addNode: vi.fn(), addEdge: vi.fn(), setUiState: store.setUiState,
    setPendingClarification: vi.fn(), updateNode: vi.fn(), removeNode: vi.fn(),
    removeEdge: vi.fn(), applyDiagram: vi.fn(), traceToolCall: vi.fn(),
    traceToolResult: vi.fn(), clearToolTrace: vi.fn(),
    setGenerationPhase: vi.fn(), clearDiagramContent: vi.fn(), setPendingTypeChoice: vi.fn(),
    addVersion: vi.fn(), setActiveOperation: store.setActiveOperation, setStreamingType: vi.fn(),
  }
  return {
    handlers,
    fakeSocket,
    store,
    toast,
    signOut: vi.fn(),
    unsubscribe: vi.fn(),
    authCb: undefined as undefined | ((event: string, session: unknown) => void),
    useStore: Object.assign(() => storeActions, {
      getState: () => ({ currentDiagram: null, setCurrentDiagramId: vi.fn(), setLastGenerationPrompt: vi.fn() }),
    }),
    useAuthStore: Object.assign(
      (selector: (s: unknown) => unknown) => selector({ user: { id: 'u1' }, session: { access_token: 'tok' } }),
      { getState: () => ({ session: { access_token: 'tok' } }) },
    ),
  }
})

vi.mock('socket.io-client', () => ({ io: vi.fn(() => h.fakeSocket), Socket: class {} }))
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn((cb: (event: string, session: unknown) => void) => {
        h.authCb = cb
        return { data: { subscription: { unsubscribe: h.unsubscribe } } }
      }),
    },
  },
}))
vi.mock('../hooks/useAuth', () => ({ signOut: h.signOut }))
vi.mock('../store/index', () => ({ useStore: h.useStore }))
vi.mock('../store/auth', () => ({ useAuthStore: h.useAuthStore }))
vi.mock('../lib/api', () => ({ persistCurrentDiagram: vi.fn(async () => ({ ok: true })) }))
vi.mock('../store/toast', () => ({ toast: h.toast }))
vi.mock('../ui/utils/diagramToJson', () => ({ diagramToJson: vi.fn() }))

import { useWebSocket } from '../hooks/useWebSocket'

beforeEach(() => {
  vi.clearAllMocks()
  h.handlers.clear()
  h.authCb = undefined
})

describe('useWebSocket — endurecimiento JWT (S10.1)', () => {
  it('auth:expired → avisa (toast) y desloguea', () => {
    renderHook(() => useWebSocket())
    expect(h.handlers.has('auth:expired')).toBe(true)

    h.handlers.get('auth:expired')!()

    expect(h.signOut).toHaveBeenCalledOnce()
    expect(h.store.setUiState).toHaveBeenCalledWith('error')
    const aviso = h.toast.error.mock.calls.find(([m]) => /expirado/i.test(m as string))
    expect(aviso).toBeTruthy()
  })

  it('TOKEN_REFRESHED → reenvía el token nuevo al socket con auth:refresh', () => {
    renderHook(() => useWebSocket())
    expect(h.authCb).toBeDefined()

    h.authCb!('TOKEN_REFRESHED', { access_token: 'token-nuevo' })
    expect(h.fakeSocket.emit).toHaveBeenCalledWith('auth:refresh', 'token-nuevo')
  })

  it('otros eventos de auth (SIGNED_IN) NO emiten auth:refresh', () => {
    renderHook(() => useWebSocket())
    h.authCb!('SIGNED_IN', { access_token: 'x' })
    expect(h.fakeSocket.emit).not.toHaveBeenCalledWith('auth:refresh', expect.anything())
  })
})
