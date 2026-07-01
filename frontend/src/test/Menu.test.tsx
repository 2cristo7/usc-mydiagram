import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Menu } from '../ui/primitives/Menu'

beforeEach(() => vi.clearAllMocks())

describe('Menu', () => {
  it('el menú está cerrado por defecto', () => {
    render(<Menu trigger={<span>abrir</span>} items={[{ label: 'Editar', onClick: () => {} }]} />)
    expect(screen.queryByText('Editar')).not.toBeInTheDocument()
  })

  it('al pulsar el trigger se despliega y muestra los items', () => {
    render(
      <Menu
        trigger={<span>abrir</span>}
        items={[{ label: 'Editar', onClick: () => {} }, { label: 'Borrar', onClick: () => {} }]}
      />,
    )
    fireEvent.click(screen.getByText('abrir'))
    expect(screen.getByText('Editar')).toBeInTheDocument()
    expect(screen.getByText('Borrar')).toBeInTheDocument()
  })

  it('pulsar un item dispara su onClick y cierra el menú', () => {
    const onClick = vi.fn()
    render(<Menu trigger={<span>abrir</span>} items={[{ label: 'Editar', onClick }]} />)
    fireEvent.click(screen.getByText('abrir'))
    fireEvent.click(screen.getByText('Editar'))
    expect(onClick).toHaveBeenCalledOnce()
    expect(screen.queryByText('Editar')).not.toBeInTheDocument()
  })

  it('un item deshabilitado se renderiza disabled', () => {
    const onClick = vi.fn()
    render(<Menu trigger={<span>abrir</span>} items={[{ label: 'Editar', onClick, disabled: true }]} />)
    fireEvent.click(screen.getByText('abrir'))
    const item = screen.getByRole('button', { name: 'Editar' })
    expect(item).toBeDisabled()
  })

  it('un click fuera cierra el menú', () => {
    render(
      <div>
        <Menu trigger={<span>abrir</span>} items={[{ label: 'Editar', onClick: () => {} }]} />
        <button>fuera</button>
      </div>,
    )
    fireEvent.click(screen.getByText('abrir'))
    expect(screen.getByText('Editar')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('button', { name: 'fuera' }))
    expect(screen.queryByText('Editar')).not.toBeInTheDocument()
  })
})
