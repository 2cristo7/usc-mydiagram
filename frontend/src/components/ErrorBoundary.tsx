import { Component, type ErrorInfo, type ReactNode } from 'react'

// Red de seguridad de último recurso: captura cualquier excepción lanzada durante
// el render de la app (un nodo con datos inesperados, un fallo de layout, etc.).
// Sin esto, un throw en render deja la pantalla en blanco sin recuperación. Aquí
// mostramos una pantalla de error con opción de reintentar o recargar.
//
// Se usa en dos escalas:
//   · GLOBAL (main.tsx): envuelve toda la app, fallback a pantalla completa.
//   · POR SECCIÓN (App.tsx): envuelve cada zona grande (canvas, chat, drawer) con
//     `compact`, de modo que un throw de render en una zona no tumbe toda la app —
//     solo esa sección muestra el aviso y el resto sigue operativo.
//
// NOTA: un Error Boundary NO captura errores fuera del render de React (eventos,
// async, errores de carga de módulos). Esos los cubren los toasts y la pantalla
// de configuración (App). Esto es la última línea para los fallos de render.

interface Props {
  children: ReactNode
  // Fallback compacto: en vez de ocupar toda la ventana, llena el hueco de su
  // sección (pensado para las boundaries por zona de App.tsx).
  compact?: boolean
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

  // Reintento sin recargar la página: limpia el estado de error y re-renderiza los
  // hijos. Útil cuando el fallo fue transitorio (datos que ya se corrigieron); si
  // el throw es determinista, el boundary lo volverá a capturar al instante.
  private reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      const { compact } = this.props
      // Layout del contenedor: pantalla completa (global) vs. lleno de la sección.
      const wrapperClass = compact
        ? 'flex h-full w-full items-center justify-center bg-[var(--color-bg)] p-4 font-[family-name:var(--font-sans)]'
        : 'flex h-screen w-screen items-center justify-center bg-[var(--color-bg)] p-6 font-[family-name:var(--font-sans)]'
      return (
        <div className={wrapperClass}>
          <div className="max-w-md border-[3px] border-[var(--color-danger)] bg-[var(--color-surface)] p-6 text-center shadow-[var(--shadow-brutal)]">
            <h1 className={`font-bold text-[var(--color-ink)] ${compact ? 'text-base' : 'text-lg'}`}>
              {compact ? 'Esta sección se ha roto' : 'Algo se ha roto'}
            </h1>
            <p className="mt-2 text-sm text-[var(--color-ink)]/70">
              {compact
                ? 'Esta parte de la interfaz encontró un error inesperado. Reintentar suele recuperarla; tu trabajo guardado sigue a salvo.'
                : 'La aplicación encontró un error inesperado. Recargar suele solucionarlo; tu trabajo guardado sigue a salvo en el historial.'}
            </p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                onClick={this.reset}
                className="border-[3px] border-[var(--color-ink)] bg-[var(--color-surface)] px-4 py-2 text-sm font-bold text-[var(--color-ink)] shadow-[var(--shadow-brutal)] transition-all hover:translate-x-[-1px] hover:translate-y-[-1px] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
              >
                Reintentar
              </button>
              <button
                onClick={() => window.location.reload()}
                className="border-[3px] border-[var(--color-ink)] bg-[var(--color-accent)] px-4 py-2 text-sm font-bold text-white shadow-[var(--shadow-brutal)] transition-all hover:translate-x-[-1px] hover:translate-y-[-1px] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
              >
                Recargar la aplicación
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
