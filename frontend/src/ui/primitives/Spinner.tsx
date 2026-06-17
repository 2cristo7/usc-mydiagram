interface SpinnerProps {
  /** Lado del cuadrado en px. ≥32 usa borde grueso (4px), si no 2px. */
  size?: number
  className?: string
  label?: string
}

// Spinner neobrutalista: un cuadrado con borde de tinta y el lado superior en
// color de acento, girando. Mismo lenguaje visual que el overlay "Generando…"
// del canvas, reutilizado en todos los estados de carga (export, historial…).
export function Spinner({ size = 16, className = '', label = 'Cargando' }: SpinnerProps) {
  const borderWidth = size >= 32 ? 4 : 2
  return (
    <span
      role="status"
      aria-label={label}
      className={`inline-block animate-spin border-[var(--color-ink)] border-t-[var(--color-accent)] ${className}`}
      style={{ width: size, height: size, borderWidth, borderStyle: 'solid' }}
    />
  )
}
