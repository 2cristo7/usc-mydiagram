import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import type { Request, Response, NextFunction } from 'express'

// S9.2 — Verificación del JWT que emite Supabase Auth.
//
// El proyecto firma con claves ES256 ASIMÉTRICAS: el gateway verifica con la
// clave pública del endpoint JWKS de Supabase, sin compartir ningún secreto.
// createRemoteJWKSet descarga el set una vez y lo cachea (refresca solo si
// aparece un `kid` desconocido), así que no hay una llamada de red por petición.
//
// Init LAZY a propósito: el JWKS se construye en la primera verificación, no al
// importar el módulo. Así no se lee SUPABASE_URL en tiempo de import — que en
// index.ts ocurre ANTES de dotenv.config() — sino cuando ya está cargada.

let jwks: JWTVerifyGetKey | null = null
let issuer: string | null = null

function getJwks(): { jwks: JWTVerifyGetKey; issuer: string } {
  if (!jwks) {
    const url = process.env.SUPABASE_URL
    if (!url) {
      throw new Error('SUPABASE_URL no está definida — necesaria para verificar los JWT de Supabase')
    }
    issuer = `${url}/auth/v1`
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`))
  }
  return { jwks, issuer: issuer! }
}

export interface AuthenticatedUser {
  userId: string
  email?: string
  // S10.1 — Caducidad (epoch en segundos) del token verificado. Se conserva para
  // guardarla en `socket.data.tokenExp` y poder comprobar la frescura de una
  // conexión viva sin re-verificar cripto en el camino caliente (ver socketAuth).
  exp?: number
}

/**
 * Verifica un access token de Supabase y extrae la identidad.
 * Lanza si el token es inválido (firma, expiración, issuer o audience).
 */
export async function verifySupabaseToken(token: string): Promise<AuthenticatedUser> {
  const { jwks, issuer } = getJwks()
  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    audience: 'authenticated',
  })

  if (!payload.sub) {
    throw new Error('Token sin claim `sub` (user_id)')
  }

  return {
    userId: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    exp: payload.exp,
  }
}

// S9.3 — Datos de autenticación adjuntados a la request por requireAuth. El
// accessToken crudo se conserva para REENVIARLO a Supabase (RLS actúa como el
// usuario), no solo el userId ya extraído.
export interface AuthedRequest extends Request {
  userId?: string
  accessToken?: string
}

/**
 * Middleware Express para las rutas de persistencia (S9.3).
 *
 * A diferencia del handshake del socket (S9.2), aquí NO hay degradación a
 * anónimo: el modelo es "login solo para guardar", así que estas rutas exigen
 * sesión. Sin token o con token inválido → 401 (el frontend debe iniciar sesión
 * o refrescar). Deja `req.userId` y `req.accessToken` para el handler.
 */
export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined
  if (!token) {
    res.status(401).json({ error: 'Falta el token de sesión' })
    return
  }
  try {
    const { userId } = await verifySupabaseToken(token)
    req.userId = userId
    req.accessToken = token
    next()
  } catch (err) {
    console.warn('REST rechazado: token inválido —', (err as Error).message)
    res.status(401).json({ error: 'Token inválido' })
  }
}
