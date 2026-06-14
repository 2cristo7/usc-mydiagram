import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/space-grotesk/400.css'
import '@fontsource/space-grotesk/600.css'
import '@fontsource/space-grotesk/700.css'
import '@fontsource/jetbrains-mono/400.css'
import './index.css'
import './store/historyManager'
import App from './App.tsx'
import { useStore } from './store/index'

// En desarrollo exponemos el store en window para que los tests e2e de
// Playwright puedan inyectar diagramas sin pasar por el backend.
// En producción (import.meta.env.DEV === false) este bloque no se ejecuta.
if (import.meta.env.DEV) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__myd_store__ = useStore
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
