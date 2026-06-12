import type { Socket } from 'socket.io'
import { verifySupabaseToken } from './auth'

// S10.1 — Frescura del token en conexiones Socket.io vivas.
//
// Problema (S9.2 dejó como deuda): `io.use` verifica el JWT SOLO en el handshake.
// Un socket que conecta con un token válido sobrevive a la expiración de ese
// token indefinidamente — convirtiendo el robo de un token de ~1h en una sesión
// perpetua. Las rutas REST (requireAuth) no sufren esto porque re-verifican en
// cada petición; el socket sí.
//
// Modelo elegido (revalidación PEREZOSA, no timer de fondo):
//   - La verificación criptográfica cara (firma/issuer/audience) ocurre solo
//     cuando ENTRA un token nuevo: en el handshake o en `auth:refresh`. Ahí se
//     guarda su `exp` en `socket.data.tokenExp`.
//   - En el camino caliente (las entradas que corren el agente) el "check" es
//     una comparación de enteros `now >= exp`, sin cripto ni red. Coste ~nulo.
//
// `socket.data.tokenExp` NO es estado de aplicación: es estado de la CONEXIÓN
// (vive y muere con el socket, se reconstruye en cada handshake). No va a BD —
// es un dato derivado del propio JWT. El backend sigue siendo stateless en lo
// que importa: no guarda sesiones de login en memoria.
//
// Límite consciente: solo se compara `exp`, no se consulta Supabase, así que una
// sesión revocada server-side sigue válida hasta su `exp` (≤1h). Detectarlo en
// tiempo real exigiría una llamada de red por acción — sobre-ingeniería para el
// alcance del proyecto.

/**
 * ¿El token vigente de esta conexión sigue vivo?
 * Conexión anónima (sin `tokenExp`) → siempre fresca: no hay token que caduque.
 */
export function isConnectionFresh(socket: Socket, nowMs: number = Date.now()): boolean {
  const exp = socket.data.tokenExp as number | undefined
  if (exp === undefined) return true
  return nowMs / 1000 < exp
}

/**
 * Guard de las entradas que corren el agente: si el token de la conexión ya
 * caducó, avisa al cliente (`auth:expired` → el frontend desloguea) y corta el
 * socket. Devuelve `false` si cortó (el handler debe abortar la operación).
 */
export function assertFreshToken(socket: Socket, nowMs: number = Date.now()): boolean {
  if (isConnectionFresh(socket, nowMs)) return true
  socket.emit('auth:expired')
  socket.disconnect(true)
  return false
}

/**
 * Renueva en caliente el `exp` de la conexión cuando el cliente refresca su
 * token (`auth:refresh`), sin recrear el socket (preserva la traza viva del
 * agente). La verificación criptográfica completa se hace aquí.
 *
 * La identidad NO puede cambiar en un socket vivo: un cambio de usuario recrea
 * el socket por diseño (useWebSocket depende de `userId`), así que un `sub`
 * distinto es una anomalía. Tanto un `sub` distinto como un token inválido se
 * tratan como la expiración: cortar la conexión. Un solo camino de fallo, sin
 * dejar al backend y al cliente con identidades divergentes.
 */
export async function handleAuthRefresh(socket: Socket, rawToken: unknown): Promise<void> {
  const token = typeof rawToken === 'string' ? rawToken : ''
  if (!token) return
  try {
    const { userId, exp } = await verifySupabaseToken(token)
    if (userId !== socket.data.userId) {
      console.warn('auth:refresh con identidad distinta a la del handshake → cortar')
      socket.emit('auth:expired')
      socket.disconnect(true)
      return
    }
    socket.data.tokenExp = exp
  } catch (err) {
    console.warn('auth:refresh con token inválido → cortar —', (err as Error).message)
    socket.emit('auth:expired')
    socket.disconnect(true)
  }
}
