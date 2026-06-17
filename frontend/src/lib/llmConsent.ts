// S10.3b — Consentimiento para guardar la API key, recordado en el navegador.
//
// El usuario solo ve el modal de consecuencias la PRIMERA vez que guarda una key.
// Una vez aceptado, este flag (localStorage, persiste entre sesiones a diferencia
// de la propia key transitoria) hace que los guardados siguientes persistan la
// key directamente sin volver a preguntar. Borrar la key revocada resetea el flag
// para que vuelva a pedirse consentimiento.

const CONSENT_KEY = 'mydiagram:llm_persist_consent'

export function hasPersistConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === '1'
  } catch {
    return false
  }
}

export function setPersistConsent(value: boolean): void {
  try {
    if (value) localStorage.setItem(CONSENT_KEY, '1')
    else localStorage.removeItem(CONSENT_KEY)
  } catch {
    // localStorage no disponible: el consentimiento no se recuerda entre sesiones;
    // el peor caso es que el modal vuelva a aparecer, nunca un guardado silencioso.
  }
}
