import { describe, it, expect, beforeEach } from 'vitest'
import { checkRateLimit, _resetRateLimit } from './rateLimit'

// S9.3b — El rate limiter (movido del agente al backend) con la ventana fija
// (count, windowStart) de S5.5. checkRateLimit acepta `now` inyectable para
// testear las fronteras de ventana sin tocar el reloj. Defaults: 5 por 60s.

describe('checkRateLimit', () => {
  beforeEach(() => _resetRateLimit())

  it('admite la primera petición de una clave nueva', () => {
    expect(checkRateLimit('u1', 1000)).toBe(true)
  })

  it('admite justo hasta el límite y rechaza la siguiente en la misma ventana', () => {
    const t = 1000
    for (let i = 0; i < 5; i++) expect(checkRateLimit('u1', t)).toBe(true)
    expect(checkRateLimit('u1', t)).toBe(false) // la 6ª se rechaza
  })

  it('reinicia la ventana pasados los 60s y vuelve a admitir', () => {
    const t = 1000
    for (let i = 0; i < 5; i++) checkRateLimit('u1', t)
    expect(checkRateLimit('u1', t)).toBe(false)
    expect(checkRateLimit('u1', t + 61_000)).toBe(true) // nueva ventana
  })

  it('NO reinicia dentro de la ventana: a los 59s sigue bloqueado (frontera S5.5)', () => {
    const t = 1000
    for (let i = 0; i < 5; i++) checkRateLimit('u1', t)
    expect(checkRateLimit('u1', t + 59_000)).toBe(false)
  })

  it('aísla por clave: un usuario en el tope no afecta a otro', () => {
    const t = 1000
    for (let i = 0; i < 5; i++) checkRateLimit('u1', t)
    expect(checkRateLimit('u1', t)).toBe(false)
    expect(checkRateLimit('u2', t)).toBe(true) // clave distinta, cubeta propia
  })
})
