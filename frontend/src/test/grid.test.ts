import { describe, it, expect } from 'vitest'
import { GRID_SIZE, snapPoint, snapValue } from '../ui/utils/grid'

describe('GRID_SIZE', () => {
  it('es 20 (coincide con el gap del Background)', () => {
    expect(GRID_SIZE).toBe(20)
  })
})

describe('snapValue', () => {
  it('redondea al múltiplo de GRID_SIZE más cercano (hacia abajo)', () => {
    expect(snapValue(29)).toBe(20)
  })
  it('redondea hacia arriba pasado el punto medio', () => {
    expect(snapValue(31)).toBe(40)
  })
  it('el punto medio exacto redondea hacia arriba (Math.round)', () => {
    expect(snapValue(30)).toBe(40) // 30/20 = 1.5 → round = 2
  })
  it('valores negativos: redondea al múltiplo más cercano', () => {
    expect(snapValue(-29)).toBe(-20)
    expect(snapValue(-31)).toBe(-40)
  })
  it('cero se queda en cero', () => {
    expect(snapValue(0)).toBe(0)
  })
  it('un valor ya alineado no cambia', () => {
    expect(snapValue(80)).toBe(80)
  })
  it('acepta un tamaño de celda personalizado', () => {
    expect(snapValue(12, 5)).toBe(10)
    expect(snapValue(13, 5)).toBe(15)
  })
})

describe('snapPoint', () => {
  it('snappea ambos ejes de forma independiente', () => {
    expect(snapPoint({ x: 29, y: 31 })).toEqual({ x: 20, y: 40 })
  })
  it('un punto ya alineado al grid no cambia', () => {
    expect(snapPoint({ x: 40, y: 60 })).toEqual({ x: 40, y: 60 })
  })
  it('coordenadas negativas', () => {
    const p = snapPoint({ x: -9, y: -11 })
    expect(p.x === 0).toBe(true) // -9/20 = -0.45 → round da -0, igual a 0 con ===
    expect(p.y).toBe(-20)
  })
  it('respeta un tamaño de celda personalizado', () => {
    expect(snapPoint({ x: 7, y: 8 }, 5)).toEqual({ x: 5, y: 10 })
  })
})
