import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createRef } from 'react'
import { Panel } from '../ui/primitives/Panel'

describe('Panel', () => {
  it('renderiza sus hijos', () => {
    render(<Panel>contenido</Panel>)
    expect(screen.getByText('contenido')).toBeInTheDocument()
  })

  it('reenvía props del DOM (onClick) al div', () => {
    const onClick = vi.fn()
    render(<Panel onClick={onClick}>clic</Panel>)
    fireEvent.click(screen.getByText('clic'))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('reenvía la ref al div', () => {
    const ref = createRef<HTMLDivElement>()
    render(<Panel ref={ref}>x</Panel>)
    expect(ref.current).toBeInstanceOf(HTMLDivElement)
  })

  it('combina la className recibida con las propias', () => {
    render(<Panel className="mi-clase">x</Panel>)
    expect(screen.getByText('x')).toHaveClass('mi-clase')
  })
})
