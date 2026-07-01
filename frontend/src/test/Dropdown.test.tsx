import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Dropdown, type DropdownOption } from '../ui/primitives/Dropdown'

const options: DropdownOption[] = [
  { value: 'a', label: 'Opción A' },
  { value: 'b', label: 'Opción B' },
]

beforeEach(() => vi.clearAllMocks())

describe('Dropdown', () => {
  it('muestra el placeholder cuando no hay valor seleccionado', () => {
    render(<Dropdown value="" options={options} onChange={() => {}} placeholder="Elige" />)
    expect(screen.getByText('Elige')).toBeInTheDocument()
  })

  it('muestra la etiqueta del valor seleccionado', () => {
    render(<Dropdown value="b" options={options} onChange={() => {}} />)
    expect(screen.getByText('Opción B')).toBeInTheDocument()
  })

  it('la lista está cerrada por defecto y se abre al pulsar el botón', () => {
    render(<Dropdown value="a" options={options} onChange={() => {}} ariaLabel="modelo" />)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'modelo' }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'modelo' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('seleccionar una opción dispara onChange y cierra la lista', () => {
    const onChange = vi.fn()
    render(<Dropdown value="a" options={options} onChange={onChange} ariaLabel="modelo" />)
    fireEvent.click(screen.getByRole('button', { name: 'modelo' }))
    fireEvent.click(screen.getByRole('option', { name: /Opción B/ }))
    expect(onChange).toHaveBeenCalledWith('b')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('marca la opción activa con aria-selected', () => {
    render(<Dropdown value="a" options={options} onChange={() => {}} ariaLabel="modelo" />)
    fireEvent.click(screen.getByRole('button', { name: 'modelo' }))
    expect(screen.getByRole('option', { name: /Opción A/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: /Opción B/ })).toHaveAttribute('aria-selected', 'false')
  })

  it('Escape cierra la lista', () => {
    render(<Dropdown value="a" options={options} onChange={() => {}} ariaLabel="modelo" />)
    fireEvent.click(screen.getByRole('button', { name: 'modelo' }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('un click fuera cierra la lista', () => {
    render(
      <div>
        <Dropdown value="a" options={options} onChange={() => {}} ariaLabel="modelo" />
        <button>fuera</button>
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'modelo' }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('button', { name: 'fuera' }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
