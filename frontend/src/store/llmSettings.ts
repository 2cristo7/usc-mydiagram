import { create } from 'zustand'
import { getLlmConfig, putLlmConfig, deleteLlmApiKey } from '../lib/api'
import type { LlmConfig, LlmConfigPayload } from '../lib/api'
import { writeTransientKey, clearTransientKey } from '../lib/transientLlmKey'
import { readLocalConfig, writeLocalConfig } from '../lib/localLlmConfig'
import { useAuthStore } from './auth'

type Provider = LlmConfig['provider']

// ¿Hay sesión iniciada? Decide la vía de persistencia de la config LLM:
//  · con sesión  → BD por usuario (REST /llm-config, RLS por auth.uid()).
//  · sin sesión  → solo el navegador (localStorage + socket de esta sesión).
function isLoggedIn(): boolean {
  return Boolean(useAuthStore.getState().session?.access_token)
}

// Empuja la key transitoria al socket vivo (lo registra useWebSocket al conectar).
// null → el socket olvida la key (borrado / paso a persistencia).
type TransientEmitter = (payload: { provider: string; api_key: string } | null) => void

// Empuja la config LLM completa al socket vivo (modo sin login): el navegador es
// la única fuente de verdad, así que el gateway necesita estos campos para
// inyectarlos en la generación. null → el socket olvida la config local.
type LocalConfigEmitter = (payload: LlmConfig | null) => void

interface LlmSettingsStore {
  config: LlmConfig | null
  loading: boolean
  error: string | null
  // Error from the backend llm:error socket event (Ollama browser transport).
  ollamaError: { error_code: string; detail: string; model?: string; provider?: Provider } | null
  // Apertura del modal de configuración (controlada por store para poder lanzarla
  // desde el banner de error, no solo desde el menú de perfil).
  modalOpen: boolean
  // Proveedor con el que abrir el modal (override puntual: p. ej. al venir desde el
  // banner de "API key inválida" abrimos ya en ese proveedor).
  forceProvider: Provider | null
  // S10.3b — emisor de la key transitoria hacia el socket vivo (lo inyecta
  // useWebSocket al conectar). null mientras no haya socket conectado.
  transientEmitter: TransientEmitter | null
  // Emisor de la config LLM completa (modo sin login). Lo inyecta useWebSocket al
  // conectar; null mientras no haya socket conectado.
  localConfigEmitter: LocalConfigEmitter | null
  loadConfig: () => Promise<void>
  saveConfig: (payload: LlmConfigPayload) => Promise<void>
  setOllamaError: (err: { error_code: string; detail: string; model?: string; provider?: Provider } | null) => void
  openModal: (provider?: Provider) => void
  closeModal: () => void
  registerTransientEmitter: (fn: TransientEmitter | null) => void
  registerLocalConfigEmitter: (fn: LocalConfigEmitter | null) => void
  // Guarda la key SOLO en el navegador (sessionStorage) y la empuja al socket.
  // Es el modo por defecto: nada se persiste en el servidor.
  setTransientKey: (provider: string, key: string) => void
  // Olvida la key transitoria (sessionStorage + socket).
  clearTransient: () => void
  // Revoca el guardado permanente de la key de un proveedor (borra de Vault).
  deleteApiKey: (provider: string) => Promise<void>
}

export const useLlmSettingsStore = create<LlmSettingsStore>((set, get) => ({
  config: null,
  loading: false,
  error: null,
  ollamaError: null,
  modalOpen: false,
  forceProvider: null,
  transientEmitter: null,
  localConfigEmitter: null,

  openModal: (provider) => set({ modalOpen: true, forceProvider: provider ?? null }),
  closeModal: () => set({ modalOpen: false, forceProvider: null }),

  loadConfig: async () => {
    // Sin sesión: la config vive en localStorage, no en la BD. Puede no existir
    // todavía (primer uso) → config queda null y el modal usa sus defaults.
    if (!isLoggedIn()) {
      set({ config: readLocalConfig(), loading: false, error: null })
      return
    }
    set({ loading: true, error: null })
    try {
      const config = await getLlmConfig()
      set({ config, loading: false })
    } catch (err) {
      set({ loading: false, error: (err as Error).message })
    }
  },

  saveConfig: async (payload: LlmConfigPayload) => {
    // Sin sesión: la config (sin la key) se guarda en localStorage y se empuja al
    // socket. La key, si la hay, viaja aparte por la vía transitoria (setTransientKey
    // en el modal). No hay PUT a la BD ni keys persistidas en Vault.
    if (!isLoggedIn()) {
      const local: LlmConfig = {
        provider: payload.provider,
        transport: payload.transport,
        model_fast: payload.model_fast,
        model_capable: payload.model_capable,
        base_url: payload.base_url,
        saved_providers: [],
      }
      writeLocalConfig(local)
      get().localConfigEmitter?.(local)
      set({ config: local, loading: false, error: null })
      return
    }
    set({ loading: true, error: null })
    try {
      await putLlmConfig(payload)
      // Optimistic: si se mandó una key, su proveedor pasa a estar en saved_providers.
      set((s) => ({
        loading: false,
        config: s.config
          ? {
              ...s.config,
              provider: payload.provider,
              transport: payload.transport,
              model_fast: payload.model_fast,
              model_capable: payload.model_capable,
              base_url: payload.base_url,
              saved_providers:
                payload.api_key && !(s.config.saved_providers ?? []).includes(payload.provider)
                  ? [...(s.config.saved_providers ?? []), payload.provider].sort()
                  : s.config.saved_providers ?? [],
            }
          : null,
      }))
    } catch (err) {
      set({ loading: false, error: (err as Error).message })
      throw err
    }
  },

  setOllamaError: (err) => set({ ollamaError: err }),

  registerTransientEmitter: (fn) => set({ transientEmitter: fn }),

  registerLocalConfigEmitter: (fn) => set({ localConfigEmitter: fn }),

  setTransientKey: (provider, key) => {
    writeTransientKey(provider, key)
    get().transientEmitter?.({ provider, api_key: key })
  },

  clearTransient: () => {
    clearTransientKey()
    get().transientEmitter?.(null)
  },

  deleteApiKey: async (provider: string) => {
    // Sin sesión no hay key en Vault: revocar es simplemente olvidar la transitoria.
    if (!isLoggedIn()) {
      get().clearTransient()
      return
    }
    set({ loading: true, error: null })
    try {
      await deleteLlmApiKey(provider)
      set((s) => ({
        loading: false,
        config: s.config
          ? { ...s.config, saved_providers: (s.config.saved_providers ?? []).filter((p) => p !== provider) }
          : null,
      }))
    } catch (err) {
      set({ loading: false, error: (err as Error).message })
      throw err
    }
  },
}))
