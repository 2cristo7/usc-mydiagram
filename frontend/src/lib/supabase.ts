import { createClient } from '@supabase/supabase-js'

// S9.2 — Cliente de Supabase Auth. Solo claves públicas (anon): RLS protege los
// datos en la BD. Gestiona la sesión OAuth de Google y el refresco automático
// del token; useWebSocket adjunta su access_token al handshake del socket.
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Flag de configuración: NO lanzamos a nivel de módulo. Un throw aquí ocurre
// durante la carga del módulo (antes de que React monte), así que ni el
// ErrorBoundary ni nada lo capturan → pantalla en blanco. En su lugar exponemos
// este flag y App muestra una pantalla de configuración legible si falta el .env.
export const isSupabaseConfigured = Boolean(url && anonKey)

if (!isSupabaseConfigured) {
  console.error('Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en el .env del frontend')
}

// Si falta la config, createClient con strings vacíos no llega a usarse (App
// corta antes con la pantalla de configuración); evita el throw de createClient.
export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'public-anon-key')
