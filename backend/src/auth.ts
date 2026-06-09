import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'

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
  }
}
