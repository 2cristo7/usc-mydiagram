import { createClient } from '@supabase/supabase-js'

// S9.2 — Cliente de Supabase Auth. Solo claves públicas (anon): RLS protege los
// datos en la BD. Gestiona la sesión OAuth de Google y el refresco automático
// del token; useWebSocket adjunta su access_token al handshake del socket.
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error('Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en el .env del frontend')
}

export const supabase = createClient(url, anonKey)
