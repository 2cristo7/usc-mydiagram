import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Tooltip } from '../ui/primitives/Tooltip'

describe('Tooltip', () => {
  it('el contenido está oculto por defecto', () => {
    render(<Tooltip content="ayuda"><button>hover</button></Tooltip>)
    expect(screen.queryByText('ayuda')).not.toBeInTheDocument()
    expect(screen.getByText('hover')).toBeInTheDocument()
  })

  it('muestra el contenido al pasar el ratón y lo oculta al salir', () => {
    render(<Tooltip content="ayuda"><button>hover</button></Tooltip>)
    const wrapper = screen.getByText('hover').parentElement as HTMLElement
    fireEvent.mouseEnter(wrapper)
    expect(screen.getByText('ayuda')).toBeInTheDocument()
    fireEvent.mouseLeave(wrapper)
    expect(screen.queryByText('ayuda')).not.toBeInTheDocument()
  })
})
