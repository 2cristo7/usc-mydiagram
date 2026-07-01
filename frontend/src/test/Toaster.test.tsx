import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { Toaster } from '../ui/primitives/Toaster'
import { useToastStore, toast } from '../store/toast'

beforeEach(() => {
  act(() => useToastStore.getState().clear())
})
afterEach(() => {
  act(() => useToastStore.getState().clear())
})

describe('Toaster', () => {
  it('no renderiza nada con la cola vacía', () => {
    const { container } = render(<Toaster />)
    expect(container.firstChild).toBeNull()
  })

  it('renderiza el mensaje de un toast en la cola', () => {
    render(<Toaster />)
    act(() => { toast.error('algo falló') })
    expect(screen.getByText('algo falló')).toBeInTheDocument()
  })

  it('un toast de error usa role="alert"', () => {
    render(<Toaster />)
    act(() => { toast.error('error grave') })
    expect(screen.getByRole('alert')).toHaveTextContent('error grave')
  })

  it('un toast de éxito usa role="status"', () => {
    render(<Toaster />)
    act(() => { toast.success('hecho') })
    expect(screen.getByRole('status')).toHaveTextContent('hecho')
  })

  it('el botón de cierre descarta el toast', () => {
    render(<Toaster />)
    act(() => { toast.info('aviso') })
    expect(screen.getByText('aviso')).toBeInTheDocument()
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Cerrar notificación' })) })
    expect(screen.queryByText('aviso')).not.toBeInTheDocument()
  })

  it('el botón de acción ejecuta su callback y descarta el toast', () => {
    const onClick = vi.fn()
    render(<Toaster />)
    act(() => { toast.error('reintentar?', { action: { label: 'Reintentar', onClick } }) })
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Reintentar' })) })
    expect(onClick).toHaveBeenCalledOnce()
    expect(screen.queryByText('reintentar?')).not.toBeInTheDocument()
  })
})
