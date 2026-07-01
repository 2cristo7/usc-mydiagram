import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'

// Mock del cliente REST: las acciones del store no deben pegar a la red real.
vi.mock('../lib/api', () => ({
  getLlmConfig: vi.fn(),
  putLlmConfig: vi.fn(),
  deleteLlmApiKey: vi.fn(),
}))

import { useLlmSettingsStore } from '../store/llmSettings'
import { useAuthStore } from '../store/auth'
import { getLlmConfig, putLlmConfig, deleteLlmApiKey } from '../lib/api'
import type { LlmConfig, LlmConfigPayload } from '../lib/api'
import { readTransientKey } from '../lib/transientLlmKey'
import { readLocalConfig } from '../lib/localLlmConfig'

const mGet = vi.mocked(getLlmConfig)
const mPut = vi.mocked(putLlmConfig)
const mDel = vi.mocked(deleteLlmApiKey)

// jsdom (origen opaco) entrega un localStorage inerte sin métodos. Instalamos
// uno en memoria para que la rama "sin login" (localLlmConfig) persista de verdad.
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
  } as Storage
}

vi.stubGlobal('localStorage', memoryStorage())

function login() {
  useAuthStore.setState({
    session: { access_token: 'tok', user: { id: 'u1' } } as unknown as Session,
    user: { id: 'u1' } as unknown as Session['user'],
    initialized: true,
  })
}
function logout() {
  useAuthStore.setState({ session: null, user: null, initialized: true })
}

const payload = (over: Partial<LlmConfigPayload> = {}): LlmConfigPayload => ({
  provider: 'openai',
  transport: 'api',
  model_fast: 'gpt-4o-mini',
  model_capable: 'gpt-4o',
  base_url: undefined,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  logout()
  useLlmSettingsStore.setState({
    config: null,
    loading: false,
    error: null,
    ollamaError: null,
    modalOpen: false,
    forceProvider: null,
    transientEmitter: null,
    localConfigEmitter: null,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('llmSettings — modal y errores', () => {
  it('openModal abre y fija forceProvider', () => {
    useLlmSettingsStore.getState().openModal('anthropic')
    expect(useLlmSettingsStore.getState().modalOpen).toBe(true)
    expect(useLlmSettingsStore.getState().forceProvider).toBe('anthropic')
  })

  it('openModal sin proveedor deja forceProvider en null', () => {
    useLlmSettingsStore.getState().openModal()
    expect(useLlmSettingsStore.getState().forceProvider).toBeNull()
  })

  it('closeModal cierra y limpia forceProvider', () => {
    useLlmSettingsStore.getState().openModal('openai')
    useLlmSettingsStore.getState().closeModal()
    expect(useLlmSettingsStore.getState().modalOpen).toBe(false)
    expect(useLlmSettingsStore.getState().forceProvider).toBeNull()
  })

  it('setOllamaError fija y limpia el error de Ollama', () => {
    useLlmSettingsStore.getState().setOllamaError({ error_code: 'X', detail: 'd' })
    expect(useLlmSettingsStore.getState().ollamaError).toEqual({ error_code: 'X', detail: 'd' })
    useLlmSettingsStore.getState().setOllamaError(null)
    expect(useLlmSettingsStore.getState().ollamaError).toBeNull()
  })
})

describe('llmSettings — loadConfig', () => {
  it('sin sesión lee de localStorage (null si no hay nada)', async () => {
    await useLlmSettingsStore.getState().loadConfig()
    expect(mGet).not.toHaveBeenCalled()
    expect(useLlmSettingsStore.getState().config).toBeNull()
    expect(useLlmSettingsStore.getState().loading).toBe(false)
  })

  it('con sesión llama a getLlmConfig y guarda la config', async () => {
    login()
    const cfg: LlmConfig = {
      provider: 'openai',
      transport: 'api',
      model_fast: 'f',
      model_capable: 'c',
      saved_providers: ['openai'],
    }
    mGet.mockResolvedValue(cfg)
    await useLlmSettingsStore.getState().loadConfig()
    expect(mGet).toHaveBeenCalledOnce()
    expect(useLlmSettingsStore.getState().config).toEqual(cfg)
    expect(useLlmSettingsStore.getState().loading).toBe(false)
  })

  it('con sesión propaga el error de getLlmConfig a error y apaga loading', async () => {
    login()
    mGet.mockRejectedValue(new Error('boom'))
    await useLlmSettingsStore.getState().loadConfig()
    expect(useLlmSettingsStore.getState().error).toBe('boom')
    expect(useLlmSettingsStore.getState().loading).toBe(false)
  })
})

describe('llmSettings — saveConfig', () => {
  it('sin sesión escribe en localStorage, empuja al localConfigEmitter y NO llama a putLlmConfig', async () => {
    const emit = vi.fn()
    useLlmSettingsStore.getState().registerLocalConfigEmitter(emit)
    await useLlmSettingsStore.getState().saveConfig(payload({ base_url: 'http://x' }))

    expect(mPut).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledOnce()
    const stored = readLocalConfig()
    expect(stored).toMatchObject({ provider: 'openai', base_url: 'http://x', saved_providers: [] })
    expect(useLlmSettingsStore.getState().config).toMatchObject({ provider: 'openai' })
  })

  it('con sesión llama a putLlmConfig y actualiza la config (sin key no toca saved_providers)', async () => {
    login()
    useLlmSettingsStore.setState({
      config: { provider: 'openai', transport: 'api', model_fast: 'old', model_capable: 'old', saved_providers: [] },
    })
    mPut.mockResolvedValue(undefined)
    await useLlmSettingsStore.getState().saveConfig(payload({ model_fast: 'new' }))

    expect(mPut).toHaveBeenCalledOnce()
    expect(useLlmSettingsStore.getState().config!.model_fast).toBe('new')
    expect(useLlmSettingsStore.getState().config!.saved_providers).toEqual([])
  })

  it('con sesión y api_key nueva añade el proveedor a saved_providers (optimista, ordenado)', async () => {
    login()
    useLlmSettingsStore.setState({
      config: { provider: 'anthropic', transport: 'api', model_fast: 'f', model_capable: 'c', saved_providers: ['anthropic'] },
    })
    mPut.mockResolvedValue(undefined)
    await useLlmSettingsStore.getState().saveConfig(payload({ provider: 'openai', api_key: 'sk-new' }))

    expect(useLlmSettingsStore.getState().config!.saved_providers).toEqual(['anthropic', 'openai'])
  })

  it('con sesión y api_key de un proveedor YA guardado no lo duplica', async () => {
    login()
    useLlmSettingsStore.setState({
      config: { provider: 'openai', transport: 'api', model_fast: 'f', model_capable: 'c', saved_providers: ['openai'] },
    })
    mPut.mockResolvedValue(undefined)
    await useLlmSettingsStore.getState().saveConfig(payload({ provider: 'openai', api_key: 'sk' }))

    expect(useLlmSettingsStore.getState().config!.saved_providers).toEqual(['openai'])
  })

  it('con sesión y config previa null deja config en null tras el PUT exitoso', async () => {
    login()
    useLlmSettingsStore.setState({ config: null })
    mPut.mockResolvedValue(undefined)
    await useLlmSettingsStore.getState().saveConfig(payload())
    expect(useLlmSettingsStore.getState().config).toBeNull()
  })

  it('con sesión, si putLlmConfig falla, guarda el error y relanza', async () => {
    login()
    mPut.mockRejectedValue(new Error('PUT 500'))
    await expect(useLlmSettingsStore.getState().saveConfig(payload())).rejects.toThrow('PUT 500')
    expect(useLlmSettingsStore.getState().error).toBe('PUT 500')
    expect(useLlmSettingsStore.getState().loading).toBe(false)
  })
})

describe('llmSettings — key transitoria', () => {
  it('setTransientKey escribe en sessionStorage y empuja al transientEmitter', () => {
    const emit = vi.fn()
    useLlmSettingsStore.getState().registerTransientEmitter(emit)
    useLlmSettingsStore.getState().setTransientKey('openai', 'sk-123')

    expect(readTransientKey()).toEqual({ provider: 'openai', key: 'sk-123' })
    expect(emit).toHaveBeenCalledWith({ provider: 'openai', api_key: 'sk-123' })
  })

  it('setTransientKey sin emisor registrado no falla', () => {
    expect(() => useLlmSettingsStore.getState().setTransientKey('openai', 'sk')).not.toThrow()
    expect(readTransientKey()).toEqual({ provider: 'openai', key: 'sk' })
  })

  it('clearTransient borra la key y notifica null al emisor', () => {
    const emit = vi.fn()
    useLlmSettingsStore.getState().registerTransientEmitter(emit)
    useLlmSettingsStore.getState().setTransientKey('openai', 'sk')
    emit.mockClear()
    useLlmSettingsStore.getState().clearTransient()

    expect(readTransientKey()).toBeNull()
    expect(emit).toHaveBeenCalledWith(null)
  })
})

describe('llmSettings — deleteApiKey', () => {
  it('sin sesión equivale a olvidar la key transitoria (no llama al backend)', async () => {
    const emit = vi.fn()
    useLlmSettingsStore.getState().registerTransientEmitter(emit)
    useLlmSettingsStore.getState().setTransientKey('openai', 'sk')
    emit.mockClear()

    await useLlmSettingsStore.getState().deleteApiKey('openai')

    expect(mDel).not.toHaveBeenCalled()
    expect(readTransientKey()).toBeNull()
    expect(emit).toHaveBeenCalledWith(null)
  })

  it('con sesión llama a deleteLlmApiKey y quita el proveedor de saved_providers', async () => {
    login()
    useLlmSettingsStore.setState({
      config: { provider: 'openai', transport: 'api', model_fast: 'f', model_capable: 'c', saved_providers: ['openai', 'anthropic'] },
    })
    mDel.mockResolvedValue(undefined)
    await useLlmSettingsStore.getState().deleteApiKey('openai')

    expect(mDel).toHaveBeenCalledWith('openai')
    expect(useLlmSettingsStore.getState().config!.saved_providers).toEqual(['anthropic'])
  })

  it('con sesión y config null deja config en null tras el borrado', async () => {
    login()
    useLlmSettingsStore.setState({ config: null })
    mDel.mockResolvedValue(undefined)
    await useLlmSettingsStore.getState().deleteApiKey('openai')
    expect(useLlmSettingsStore.getState().config).toBeNull()
  })

  it('con sesión, si deleteLlmApiKey falla, guarda el error y relanza', async () => {
    login()
    mDel.mockRejectedValue(new Error('DEL 500'))
    await expect(useLlmSettingsStore.getState().deleteApiKey('openai')).rejects.toThrow('DEL 500')
    expect(useLlmSettingsStore.getState().error).toBe('DEL 500')
    expect(useLlmSettingsStore.getState().loading).toBe(false)
  })
})
