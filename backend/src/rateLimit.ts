// S9.3b — Rate limiter, trasladado del agente al backend (decisión P1=B): el
// backend es el único punto de entrada, así que el control de admisión vive aquí
// y el agente queda con solo lógica de agente.
//
// Ventana FIJA con la tupla (count, windowStart) — el patrón correcto de S5.5
// (no un simple contador con reset a hora fija, que permitiría bypass en la
// frontera; ver pendientes.md). Store en memoria del proceso: suficiente para el
// TFG (un solo backend); si se escalara a varias instancias, iría a Redis/BD.
//
// Clave por IDENTIDAD, no por IP del proceso: con sesión, el user_id (de S9.2);
// sin sesión, la IP del socket. Esto arregla la limitación del limiter previo del
// agente, que veía siempre la IP del backend (una sola cubeta global).

const RATE_LIMIT = Number(process.env.RATE_LIMIT ?? 5)
const WINDOW_SECONDS = Number(process.env.RATE_LIMIT_WINDOW_SECONDS ?? 60)

interface Window {
  count: number
  windowStart: number
}

const store = new Map<string, Window>()

/**
 * Registra una petición de `key` y dice si se admite.
 *
 * INVARIANTE S9.3b (b): se llama UNA vez por petición, ANTES de mirar la caché,
 * así que un hit de caché también cuenta — la caché no puede usarse para evadir
 * el límite. Un usuario en el tope ni siquiera llega al lookup.
 *
 * @returns true si la petición se admite (e incrementa el contador); false si se
 *   superó el límite en la ventana actual.
 */
export function checkRateLimit(key: string, now: number = Date.now()): boolean {
  const entry = store.get(key)
  if (!entry) {
    store.set(key, { count: 1, windowStart: now })
    return true
  }
  if (now - entry.windowStart > WINDOW_SECONDS * 1000) {
    // Ventana expirada: empieza una nueva con esta petición.
    store.set(key, { count: 1, windowStart: now })
    return true
  }
  if (entry.count >= RATE_LIMIT) {
    return false
  }
  entry.count += 1
  return true
}

// Solo para tests: vaciar el store entre casos.
export function _resetRateLimit(): void {
  store.clear()
}
