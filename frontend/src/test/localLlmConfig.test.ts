import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest'
import { readLocalConfig, writeLocalConfig, clearLocalConfig } from '../lib/localLlmConfig'
import type { LlmConfig } from '../lib/api'

const STORAGE_KEY = 'mydiagram:local_llm_config'

// jsdom corre en un origen opaco (about:blank): su `localStorage` es un objeto
// inerte sin métodos. Instalamos una implementación en memoria, local a este
// fichero, para poder probar la persistencia real. No tocamos setup.ts.
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

afterAll(() => {
  vi.unstubAllGlobals()
})

const sample = (over: Partial<LlmConfig> = {}): LlmConfig => ({
  provider: 'openai',
  transport: 'api',
  model_fast: 'gpt-4o-mini',
  model_capable: 'gpt-4o',
  base_url: 'http://localhost:11434',
  saved_providers: [],
  ...over,
})

beforeEach(() => {
  localStorage.clear()
})

describe('localLlmConfig (localStorage)', () => {
  it('write + read recupera la parte no secreta de la config', () => {
    writeLocalConfig(sample())
    const read = readLocalConfig()
    expect(read).toEqual({
      provider: 'openai',
      transport: 'api',
      model_fast: 'gpt-4o-mini',
      model_capable: 'gpt-4o',
      base_url: 'http://localhost:11434',
      saved_providers: [], // siempre [] en modo sin login
    })
  })

  it('read devuelve null si no hay config guardada', () => {
    expect(readLocalConfig()).toBeNull()
  })

  it('write NO persiste saved_providers (se fuerza a [] al leer)', () => {
    writeLocalConfig(sample({ saved_providers: ['openai', 'anthropic'] }))
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(raw.saved_providers).toBeUndefined()
    expect(readLocalConfig()!.saved_providers).toEqual([])
  })

  it('read normaliza base_url ausente a undefined', () => {
    writeLocalConfig(sample({ base_url: undefined }))
    expect(readLocalConfig()!.base_url).toBeUndefined()
  })

  it('read devuelve null ante JSON corrupto', () => {
    localStorage.setItem(STORAGE_KEY, 'no es json {')
    expect(readLocalConfig()).toBeNull()
  })

  it('read devuelve null si faltan campos obligatorios', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ provider: 'openai', transport: 'api' }))
    expect(readLocalConfig()).toBeNull()
  })

  it('read devuelve null si un campo tiene tipo inválido', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ provider: 'openai', transport: 'api', model_fast: 1, model_capable: 'x' }),
    )
    expect(readLocalConfig()).toBeNull()
  })

  it('clear elimina la config almacenada', () => {
    writeLocalConfig(sample())
    clearLocalConfig()
    expect(readLocalConfig()).toBeNull()
  })
})
