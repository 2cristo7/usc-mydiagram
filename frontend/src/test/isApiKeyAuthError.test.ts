import { describe, it, expect } from 'vitest'
import { isApiKeyAuthError } from '../hooks/useWebSocket'

// Detección del fallo de auth de la API key (HTTP 401) en el detalle de un
// `llm_error`. Es la firma que dispara el reintento automático en sitio (la key
// transitoria se perdió al reconectar el socket). Debe reconocer los DOS mensajes
// que manda el agente Python y NO confundirse con otros errores de LLM.
describe('isApiKeyAuthError', () => {
  it('reconoce el mensaje del streaming (HTTP 401 explícito)', () => {
    expect(
      isApiKeyAuthError('La API key del proveedor LLM no es válida o falta (HTTP 401).'),
    ).toBe(true)
  })

  it('reconoce el mensaje del loop ReAct (no es válida o ha caducado)', () => {
    expect(
      isApiKeyAuthError(
        'La API key de OpenAI no es válida o ha caducado. Genera o copia una válida en … y pégala en «Configuración del modelo de lenguaje».',
      ),
    ).toBe(true)
  })

  it('es insensible a mayúsculas', () => {
    expect(isApiKeyAuthError('LA API KEY NO ES VÁLIDA')).toBe(true)
  })

  it('NO confunde un rate limit con un fallo de auth', () => {
    expect(
      isApiKeyAuthError('Has superado el límite de uso (o la cuota) de OpenAI.'),
    ).toBe(false)
  })

  it('NO confunde un error de conexión con un fallo de auth', () => {
    expect(
      isApiKeyAuthError('No se pudo conectar con el proveedor LLM. Inténtalo de nuevo.'),
    ).toBe(false)
  })

  it('exige mención de la API key: un 401 sin contexto de key no cuenta', () => {
    expect(isApiKeyAuthError('Error 401 inesperado en el endpoint /foo')).toBe(false)
  })

  it('detalle vacío o indefinido → false', () => {
    expect(isApiKeyAuthError(undefined)).toBe(false)
    expect(isApiKeyAuthError('')).toBe(false)
  })
})
