import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createRef } from 'react'
import { Card } from '../ui/primitives/Card'

describe('Card', () => {
  it('renderiza sus hijos', () => {
    render(<Card>contenido</Card>)
    expect(screen.getByText('contenido')).toBeInTheDocument()
  })

  it('reenvía props del DOM (onClick) al div', () => {
    const onClick = vi.fn()
    render(<Card onClick={onClick}>clic</Card>)
    fireEvent.click(screen.getByText('clic'))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('reenvía la ref al div', () => {
    const ref = createRef<HTMLDivElement>()
    render(<Card ref={ref}>x</Card>)
    expect(ref.current).toBeInstanceOf(HTMLDivElement)
  })

  it('combina la className recibida con las propias', () => {
    render(<Card className="mi-clase">x</Card>)
    expect(screen.getByText('x')).toHaveClass('mi-clase')
  })
})
