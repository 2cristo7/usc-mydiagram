import { describe, it, expect } from 'vitest'
import type { Node } from '@xyflow/react'
import {
  ARCH_ICON_VIS,
  ARCH_PAD,
  ARCH_GAP,
  ARCH_ICON_BOX,
  isArchBottle,
  archIconCenterLocal,
  archBottlePolygon,
  archFootprintLocalBounds,
  rayIntersectPolygon,
  type Pt,
} from '../ui/utils/archBottle'

describe('constantes de la silueta botella', () => {
  it('ARCH_ICON_BOX = ICON_VIS + 2·PAD', () => {
    expect(ARCH_ICON_BOX).toBe(ARCH_ICON_VIS + 2 * ARCH_PAD)
    expect(ARCH_ICON_BOX).toBe(72)
  })
})

describe('isArchBottle', () => {
  it('true solo para type "archIcon"', () => {
    expect(isArchBottle({ type: 'archIcon' } as Node)).toBe(true)
  })
  it('false para otros tipos y para sin tipo', () => {
    expect(isArchBottle({ type: 'flow' } as Node)).toBe(false)
    expect(isArchBottle({} as Node)).toBe(false)
  })
})

describe('archIconCenterLocal', () => {
  it('es el centro de la caja medida 72×72', () => {
    expect(archIconCenterLocal()).toEqual({ x: 36, y: 36 })
  })
})

describe('archBottlePolygon', () => {
  it('sin texto (Wt<=0 o Ht<=0) → solo la caja del icono (4 vértices)', () => {
    const IB = ARCH_ICON_BOX
    const expected: Pt[] = [
      { x: 0, y: 0 }, { x: IB, y: 0 },
      { x: IB, y: IB }, { x: 0, y: IB },
    ]
    expect(archBottlePolygon(0, 50)).toEqual(expected)
    expect(archBottlePolygon(50, 0)).toEqual(expected)
    expect(archBottlePolygon(-5, -5)).toEqual(expected)
  })

  it('texto MÁS ANCHO que el icono → 8 vértices con cuello arriba y cuerpo abajo', () => {
    // Wt=100 → TW = 108 > 72. cx=36.
    const poly = archBottlePolygon(100, 30)
    expect(poly).toHaveLength(8)
    const TW = 100 + 2 * ARCH_PAD // 108
    const TH = 30 + 2 * ARCH_PAD // 38
    const ty0 = ARCH_ICON_VIS + ARCH_GAP // 74
    const ty1 = ty0 + TH // 112
    const tx0 = 36 - TW / 2 // -18
    const tx1 = 36 + TW / 2 // 90
    // El cuerpo del texto rebasa lateralmente la caja del icono (tx0<0, tx1>72).
    expect(poly).toContainEqual({ x: tx0, y: ty1 })
    expect(poly).toContainEqual({ x: tx1, y: ty1 })
    // Cuello: vértices superiores del texto a la altura ty0.
    expect(poly).toContainEqual({ x: tx0, y: ty0 })
    expect(poly).toContainEqual({ x: tx1, y: ty0 })
    // Hombros del icono.
    expect(poly).toContainEqual({ x: 0, y: 0 })
    expect(poly).toContainEqual({ x: ARCH_ICON_BOX, y: 0 })
  })

  it('texto MÁS ESTRECHO que el icono → escalón hacia dentro (8 vértices)', () => {
    // Wt=10 → TW = 18 < 72.
    const poly = archBottlePolygon(10, 20)
    expect(poly).toHaveLength(8)
    const IB = ARCH_ICON_BOX
    const TW = 10 + 2 * ARCH_PAD // 18
    const TH = 20 + 2 * ARCH_PAD // 28
    const ty1 = ARCH_ICON_VIS + ARCH_GAP + TH // 102
    const tx0 = 36 - TW / 2 // 27
    const tx1 = 36 + TW / 2 // 45
    // El escalón parte del borde inferior del icono (y=IB) hacia dentro.
    expect(poly).toContainEqual({ x: IB, y: IB })
    expect(poly).toContainEqual({ x: tx1, y: IB })
    expect(poly).toContainEqual({ x: tx1, y: ty1 })
    expect(poly).toContainEqual({ x: tx0, y: ty1 })
    expect(poly).toContainEqual({ x: tx0, y: IB })
    expect(poly).toContainEqual({ x: 0, y: IB })
  })
})

describe('archFootprintLocalBounds', () => {
  it('sin texto → caja del icono 0..72', () => {
    expect(archFootprintLocalBounds(0, 0)).toEqual({ left: 0, right: 72, top: 0, bottom: 72 })
  })

  it('texto ancho → extiende left/right y bottom más allá del icono', () => {
    const b = archFootprintLocalBounds(100, 30)
    const TW = 108, TH = 38
    expect(b.left).toBe(36 - TW / 2) // -18 (sobresale por la izquierda)
    expect(b.right).toBe(36 + TW / 2) // 90 (sobresale por la derecha)
    expect(b.top).toBe(0)
    expect(b.bottom).toBe(ARCH_ICON_VIS + ARCH_GAP + TH) // 112
  })

  it('texto estrecho → left/right no se encogen por debajo de la caja del icono', () => {
    const b = archFootprintLocalBounds(10, 20)
    expect(b.left).toBe(0) // min(0, 27) = 0
    expect(b.right).toBe(72) // max(72, 45) = 72
    expect(b.bottom).toBe(ARCH_ICON_VIS + ARCH_GAP + 28) // 102
  })
})

describe('rayIntersectPolygon', () => {
  // Cuadrado unitario centrado en (5,5), lado 10: vértices (0,0)(10,0)(10,10)(0,10).
  const square: Pt[] = [
    { x: 0, y: 0 }, { x: 10, y: 0 },
    { x: 10, y: 10 }, { x: 0, y: 10 },
  ]
  const center: Pt = { x: 5, y: 5 }

  it('rayo hacia la DERECHA corta el lado derecho en (10,5)', () => {
    const hit = rayIntersectPolygon(center, { x: 1, y: 0 }, square)
    expect(hit.x).toBeCloseTo(10)
    expect(hit.y).toBeCloseTo(5)
  })

  it('rayo hacia ARRIBA corta el lado superior en (5,0)', () => {
    const hit = rayIntersectPolygon(center, { x: 0, y: -1 }, square)
    expect(hit.x).toBeCloseTo(5)
    expect(hit.y).toBeCloseTo(0)
  })

  it('rayo hacia ABAJO corta el lado inferior en (5,10)', () => {
    const hit = rayIntersectPolygon(center, { x: 0, y: 1 }, square)
    expect(hit.x).toBeCloseTo(5)
    expect(hit.y).toBeCloseTo(10)
  })

  it('rayo DIAGONAL sale por la esquina (10,10)', () => {
    const hit = rayIntersectPolygon(center, { x: 1, y: 1 }, square)
    expect(hit.x).toBeCloseTo(10)
    expect(hit.y).toBeCloseTo(10)
  })

  it('devuelve la PRIMERA intersección hacia fuera (la t menor)', () => {
    // Origen fuera, a la izquierda, rayo hacia la derecha: cruza primero x=0.
    const hit = rayIntersectPolygon({ x: -5, y: 5 }, { x: 1, y: 0 }, square)
    expect(hit.x).toBeCloseTo(0)
    expect(hit.y).toBeCloseTo(5)
  })

  it('rayo que no cruza (vector nulo de dirección no degenera, pero sin cruce) → devuelve el origen', () => {
    // Origen fuera y rayo alejándose del polígono: ningún cruce con t>0.
    const origin: Pt = { x: 50, y: 50 }
    const hit = rayIntersectPolygon(origin, { x: 1, y: 1 }, square)
    expect(hit).toEqual(origin)
  })

  it('escala el resultado por el módulo del vector dirección (t aplicado al dir crudo)', () => {
    // dir no unitario hacia la derecha: el punto sigue cayendo en el borde.
    const hit = rayIntersectPolygon(center, { x: 2, y: 0 }, square)
    expect(hit.x).toBeCloseTo(10)
    expect(hit.y).toBeCloseTo(5)
  })
})
