import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Drawer } from '../ui/primitives/Drawer'

beforeEach(() => vi.clearAllMocks())

describe('Drawer', () => {
  it('no renderiza nada cuando open es false', () => {
    render(<Drawer open={false} onClose={() => {}}><p>contenido</p></Drawer>)
    expect(screen.queryByText('contenido')).not.toBeInTheDocument()
  })

  it('renderiza el contenido cuando open es true', () => {
    render(<Drawer open onClose={() => {}}><p>contenido</p></Drawer>)
    expect(screen.getByText('contenido')).toBeInTheDocument()
  })

  it('un click en el panel (dentro) NO cierra', () => {
    const onClose = vi.fn()
    render(<Drawer open onClose={onClose}><p>contenido</p></Drawer>)
    fireEvent.mouseDown(screen.getByText('contenido'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('un mousedown fuera del panel (en el overlay) dispara onClose', () => {
    const onClose = vi.fn()
    const { container } = render(<Drawer open onClose={onClose}><p>contenido</p></Drawer>)
    // El overlay es el contenedor exterior fixed inset-0.
    const overlay = container.querySelector('.fixed.inset-0') as HTMLElement
    fireEvent.mouseDown(overlay)
    expect(onClose).toHaveBeenCalledOnce()
  })
})
