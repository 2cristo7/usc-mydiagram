// Configuración LLM LOCAL (modo sin login).
//
// Cuando NO hay sesión iniciada, la configuración del modelo (proveedor,
// transporte, modelos y base_url) no puede persistirse por usuario en la BD
// (no hay `auth.uid()`). En su lugar vive solo en el navegador, en
// `localStorage`, así que sobrevive a recargas pero nunca abandona el cliente.
//
// La API key NO se guarda aquí: sigue su vía transitoria (sessionStorage, ver
// `transientLlmKey.ts`), porque es la credencial sensible y debe morir al cerrar
// la pestaña. Esta ranura solo guarda la parte no secreta de la config.
//
// Igual que la key transitoria, esta config se empuja al socket para que el
// gateway (resolveLlmConfig) la inyecte en la generación del agente cuando la
// conexión es anónima.

import type { LlmConfig } from './api'

const STORAGE_KEY = 'mydiagram:local_llm_config'

// La parte no secreta de la config: LlmConfig sin la lista de keys guardadas en
// Vault (que en modo sin login no existe).
export type LocalLlmConfig = Omit<LlmConfig, 'saved_providers'>

export function readLocalConfig(): LlmConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<LocalLlmConfig>
    if (
      typeof p?.provider === 'string' &&
      typeof p?.transport === 'string' &&
      typeof p?.model_fast === 'string' &&
      typeof p?.model_capable === 'string'
    ) {
      return {
        provider: p.provider as LlmConfig['provider'],
        transport: p.transport as LlmConfig['transport'],
        model_fast: p.model_fast,
        model_capable: p.model_capable,
        base_url: typeof p.base_url === 'string' ? p.base_url : undefined,
        // En modo sin login nunca hay keys persistidas en Vault.
        saved_providers: [],
      }
    }
    return null
  } catch {
    return null
  }
}

export function writeLocalConfig(config: LocalLlmConfig): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        provider: config.provider,
        transport: config.transport,
        model_fast: config.model_fast,
        model_capable: config.model_capable,
        base_url: config.base_url,
      }),
    )
  } catch {
    // localStorage no disponible (modo privado estricto): la config no sobrevive
    // a la recarga, pero la generación de esta sesión sigue funcionando mientras
    // el socket la tenga en memoria.
  }
}

export function clearLocalConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // no-op
  }
}
