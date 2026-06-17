/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  // URL del gateway (REST). Fallback a http://localhost:3001 en api.ts.
  readonly VITE_API_URL: string
  // URL del WebSocket (Socket.io). Fallback a http://localhost:3001 en useWebSocket.ts.
  readonly VITE_WS_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
