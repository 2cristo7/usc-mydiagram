// S10.3b — Almacén de la API key TRANSITORIA.
//
// En el modo por defecto la key NO se persiste en el servidor: vive solo en el
// navegador, en `sessionStorage`, así que sobrevive a recargas de página pero
// se borra al cerrar la pestaña. El usuario debe reintroducirla en cada sesión
// de trabajo (eso es lo que hace verdadero el mensaje "nunca se guarda").
//
// El modelo de config es una sola fila por usuario (un proveedor activo), así
// que basta una única ranura: { provider, key }. Cambiar de proveedor y guardar
// una key nueva sobrescribe la anterior.
//
// Quien necesita esta key es la GENERACIÓN (el agente Python), no el cliente.
// Por eso, además de guardarla aquí, se empuja al socket (`llm:set_transient_key`)
// para que el gateway la inyecte en el body del agente. El empuje lo orquesta
// useWebSocket (al conectar) y el modal de ajustes (al guardar).

const STORAGE_KEY = 'mydiagram:transient_llm_key'

export interface TransientKey {
  provider: string
  key: string
}

export function readTransientKey(): TransientKey | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<TransientKey>
    if (typeof parsed?.provider === 'string' && typeof parsed?.key === 'string' && parsed.key) {
      return { provider: parsed.provider, key: parsed.key }
    }
    return null
  } catch {
    return null
  }
}

export function writeTransientKey(provider: string, key: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ provider, key }))
  } catch {
    // sessionStorage no disponible (modo privado estricto): la key simplemente
    // no sobrevive a la recarga; la generación de esta sesión sigue funcionando
    // mientras el socket la tenga en memoria.
  }
}

export function clearTransientKey(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // no-op
  }
}
