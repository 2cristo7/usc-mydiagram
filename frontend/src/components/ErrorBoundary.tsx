import { Component, type ErrorInfo, type ReactNode } from 'react'

// Red de seguridad de último recurso: captura cualquier excepción lanzada durante
// el render de la app (un nodo con datos inesperados, un fallo de layout, etc.).
// Sin esto, un throw en render deja la pantalla en blanco sin recuperación. Aquí
// mostramos una pantalla de error con opción de recargar.
//
// NOTA: un Error Boundary NO captura errores fuera del render de React (eventos,
// async, errores de carga de módulos). Esos los cubren los toasts y la pantalla
// de configuración (App). Esto es la última línea para los fallos de render.

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] render error:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen w-screen items-center justify-center bg-[var(--color-bg)] p-6 font-[family-name:var(--font-sans)]">
          <div className="max-w-md border-[3px] border-[var(--color-danger)] bg-[var(--color-surface)] p-6 text-center shadow-[var(--shadow-brutal)]">
            <h1 className="text-lg font-bold text-[var(--color-ink)]">Algo se ha roto</h1>
            <p className="mt-2 text-sm text-[var(--color-ink)]/70">
              La aplicación encontró un error inesperado. Recargar suele solucionarlo;
              tu trabajo guardado sigue a salvo en el historial.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 border-[3px] border-[var(--color-ink)] bg-[var(--color-accent)] px-4 py-2 text-sm font-bold text-white shadow-[var(--shadow-brutal)] transition-all hover:translate-x-[-1px] hover:translate-y-[-1px] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
            >
              Recargar la aplicación
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
