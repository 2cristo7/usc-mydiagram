import { describe, it, expect, beforeEach } from 'vitest'
import { beginDragCursor, endDragCursor } from '../ui/utils/dragCursor'

// dragCursor mantiene un contador de profundidad a nivel de módulo. Cada test
// deja el contador en 0 (begin/end balanceados) para no contaminar al siguiente,
// y el beforeEach limpia el body por si acaso.
beforeEach(() => {
  document.body.classList.remove('is-dragging')
  document.body.style.removeProperty('--drag-cursor')
})

describe('beginDragCursor / endDragCursor', () => {
  it('begin añade la clase is-dragging y fija --drag-cursor (grabbing por defecto)', () => {
    beginDragCursor()
    expect(document.body.classList.contains('is-dragging')).toBe(true)
    expect(document.body.style.getPropertyValue('--drag-cursor')).toBe('grabbing')
    endDragCursor() // limpia para el siguiente test
  })

  it('begin acepta un cursor personalizado', () => {
    beginDragCursor('ew-resize')
    expect(document.body.style.getPropertyValue('--drag-cursor')).toBe('ew-resize')
    endDragCursor()
  })

  it('end limpia la clase y la variable cuando el contador vuelve a 0', () => {
    beginDragCursor()
    endDragCursor()
    expect(document.body.classList.contains('is-dragging')).toBe(false)
    expect(document.body.style.getPropertyValue('--drag-cursor')).toBe('')
  })

  it('gestos ANIDADOS: el cursor solo se limpia al cerrar el más externo', () => {
    beginDragCursor('grabbing')
    beginDragCursor('crosshair') // anidado: pisa la variable pero no resetea el contador
    expect(document.body.style.getPropertyValue('--drag-cursor')).toBe('crosshair')

    endDragCursor() // depth 2 → 1: sigue activo
    expect(document.body.classList.contains('is-dragging')).toBe(true)
    expect(document.body.style.getPropertyValue('--drag-cursor')).toBe('crosshair')

    endDragCursor() // depth 1 → 0: ahora sí limpia
    expect(document.body.classList.contains('is-dragging')).toBe(false)
    expect(document.body.style.getPropertyValue('--drag-cursor')).toBe('')
  })

  it('end de más (sin begin) no rompe: el contador no baja de 0', () => {
    // El contador ya está en 0 aquí. Un end extra lo deja en 0 y limpia el body.
    endDragCursor()
    expect(document.body.classList.contains('is-dragging')).toBe(false)
    expect(document.body.style.getPropertyValue('--drag-cursor')).toBe('')

    // Tras el end de más, un ciclo normal sigue funcionando (no quedó "deuda").
    beginDragCursor()
    expect(document.body.classList.contains('is-dragging')).toBe(true)
    endDragCursor()
    expect(document.body.classList.contains('is-dragging')).toBe(false)
  })
})
