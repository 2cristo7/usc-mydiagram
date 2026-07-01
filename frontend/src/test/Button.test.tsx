import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createRef } from 'react'
import { Button } from '../ui/primitives/Button'

describe('Button', () => {
  it('renderiza su contenido', () => {
    render(<Button>Guardar</Button>)
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeInTheDocument()
  })

  it('dispara onClick al pulsarlo', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Guardar</Button>)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('cuando está disabled no dispara onClick', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick} disabled>Guardar</Button>)
    const btn = screen.getByRole('button')
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('reenvía la ref al elemento button', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<Button ref={ref}>X</Button>)
    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
  })

  it('acepta className adicional', () => {
    render(<Button className="extra-clase">X</Button>)
    expect(screen.getByRole('button')).toHaveClass('extra-clase')
  })
})
