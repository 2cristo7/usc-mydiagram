import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createRef } from 'react'
import { IconButton } from '../ui/primitives/IconButton'

describe('IconButton', () => {
  it('renderiza el icono que recibe', () => {
    render(<IconButton icon={<svg data-testid="icono" />} />)
    expect(screen.getByTestId('icono')).toBeInTheDocument()
  })

  it('aplica el tooltip como atributo title', () => {
    render(<IconButton icon={<span />} tooltip="Descargar" />)
    expect(screen.getByRole('button')).toHaveAttribute('title', 'Descargar')
  })

  it('dispara onClick al pulsarlo', () => {
    const onClick = vi.fn()
    render(<IconButton icon={<span />} onClick={onClick} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('cuando está disabled no dispara onClick', () => {
    const onClick = vi.fn()
    render(<IconButton icon={<span />} onClick={onClick} disabled />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('reenvía la ref al elemento button', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<IconButton icon={<span />} ref={ref} />)
    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
  })
})
