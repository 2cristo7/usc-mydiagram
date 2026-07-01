import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AlertBanner } from '../ui/primitives/AlertBanner'

describe('AlertBanner', () => {
  it('muestra el mensaje con role="alert"', () => {
    render(<AlertBanner message="algo va mal" />)
    expect(screen.getByRole('alert')).toHaveTextContent('algo va mal')
  })

  it('sin onDismiss no muestra el botón de cierre', () => {
    render(<AlertBanner message="aviso fijo" />)
    expect(screen.queryByRole('button', { name: 'Cerrar alerta' })).not.toBeInTheDocument()
  })

  it('con onDismiss muestra el botón de cierre y lo dispara al pulsarlo', () => {
    const onDismiss = vi.fn()
    render(<AlertBanner message="cerrable" onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar alerta' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('renderiza el botón de acción y ejecuta su callback', () => {
    const onClick = vi.fn()
    render(<AlertBanner message="config" action={{ label: 'Abrir configuración', onClick }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir configuración' }))
    expect(onClick).toHaveBeenCalledOnce()
  })
})
