import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/space-grotesk/400.css'
import '@fontsource/space-grotesk/600.css'
import '@fontsource/space-grotesk/700.css'
import '@fontsource/jetbrains-mono/400.css'
import './index.css'
import './store/historyManager'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useStore } from './store/index'
import { useAuthStore } from './store/auth'
import { useLlmSettingsStore } from './store/llmSettings'

// En desarrollo exponemos los stores en window para que los tests e2e (y el
// script de capturas de la web de ayuda) puedan inyectar estado sin pasar por
// el backend: diagrama, sesión simulada y apertura del modal de configuración.
// En producción (import.meta.env.DEV === false) este bloque no se ejecuta.
if (import.meta.env.DEV) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  w.__myd_store__ = useStore
  w.__myd_auth__ = useAuthStore
  w.__myd_llm__ = useLlmSettingsStore
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
