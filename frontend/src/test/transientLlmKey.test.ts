import { beforeEach, describe, expect, it } from 'vitest'
import { readTransientKey, writeTransientKey, clearTransientKey } from '../lib/transientLlmKey'

const STORAGE_KEY = 'mydiagram:transient_llm_key'

beforeEach(() => {
  sessionStorage.clear()
})

describe('transientLlmKey (sessionStorage)', () => {
  it('write + read recupera la ranura provider/key', () => {
    writeTransientKey('openai', 'sk-123')
    expect(readTransientKey()).toEqual({ provider: 'openai', key: 'sk-123' })
  })

  it('write sobrescribe la ranura anterior (una sola key por usuario)', () => {
    writeTransientKey('openai', 'sk-1')
    writeTransientKey('anthropic', 'sk-2')
    expect(readTransientKey()).toEqual({ provider: 'anthropic', key: 'sk-2' })
  })

  it('read devuelve null si no hay nada guardado', () => {
    expect(readTransientKey()).toBeNull()
  })

  it('clear borra la ranura', () => {
    writeTransientKey('openai', 'sk-123')
    clearTransientKey()
    expect(readTransientKey()).toBeNull()
  })

  it('read devuelve null ante JSON corrupto', () => {
    sessionStorage.setItem(STORAGE_KEY, '{no es json')
    expect(readTransientKey()).toBeNull()
  })

  it('read rechaza payloads con tipos inválidos (provider numérico)', () => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ provider: 1, key: 'x' }))
    expect(readTransientKey()).toBeNull()
  })

  it('read rechaza key vacía (string falsy)', () => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ provider: 'openai', key: '' }))
    expect(readTransientKey()).toBeNull()
  })

  it('read rechaza payload sin provider', () => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ key: 'x' }))
    expect(readTransientKey()).toBeNull()
  })
})
