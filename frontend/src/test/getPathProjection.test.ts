import { describe, it, expect } from 'vitest'
import { projectOntoPath, getPointAtT } from '../ui/utils/getPathProjection'

// jsdom NO implementa getTotalLength/getPointAtLength en SVGPathElement, así que
// fabricamos paths analíticos cuya parametrización por longitud conocemos. La
// firma usada por el código es { getTotalLength(), getPointAtLength(len) }.
type FakePath = Pick<SVGPathElement, 'getTotalLength' | 'getPointAtLength'>

// Segmento recto de (x0,y0) a (x1,y1). getPointAtLength interpola linealmente.
function straightPath(x0: number, y0: number, x1: number, y1: number): FakePath {
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.hypot(dx, dy)
  return {
    getTotalLength: () => len,
    getPointAtLength: (l: number) => {
      const tt = len === 0 ? 0 : l / len
      return { x: x0 + dx * tt, y: y0 + dy * tt } as DOMPoint
    },
  }
}

// Semicircunferencia superior de radio r centrada en (cx,cy), de ángulo π a 0
// (de izquierda a derecha por arriba). Longitud total = π·r.
function semicirclePath(cx: number, cy: number, r: number): FakePath {
  const len = Math.PI * r
  return {
    getTotalLength: () => len,
    getPointAtLength: (l: number) => {
      const angle = Math.PI - (l / len) * Math.PI // π → 0
      return { x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) } as DOMPoint
    },
  }
}

describe('getPointAtT', () => {
  const path = straightPath(0, 0, 100, 0)

  it('t=0 → punto inicial', () => {
    expect(getPointAtT(path as SVGPathElement, 0)).toEqual({ x: 0, y: 0 })
  })
  it('t=1 → punto final', () => {
    const p = getPointAtT(path as SVGPathElement, 1)
    expect(p.x).toBeCloseTo(100)
    expect(p.y).toBeCloseTo(0)
  })
  it('t=0.5 → punto medio', () => {
    const p = getPointAtT(path as SVGPathElement, 0.5)
    expect(p.x).toBeCloseTo(50)
    expect(p.y).toBeCloseTo(0)
  })
})

describe('projectOntoPath', () => {
  const path = straightPath(0, 0, 100, 0)

  it('punto justo sobre el path → proyecta sobre sí mismo (t≈0.3)', () => {
    const r = projectOntoPath(path as SVGPathElement, { x: 30, y: 0 })
    expect(r.t).toBeCloseTo(0.3, 2)
    expect(r.point.x).toBeCloseTo(30, 1)
    expect(r.point.y).toBeCloseTo(0, 4)
  })

  it('punto por encima del segmento → proyección perpendicular (mismo x, y=0)', () => {
    const r = projectOntoPath(path as SVGPathElement, { x: 70, y: 25 })
    expect(r.point.x).toBeCloseTo(70, 1)
    expect(r.point.y).toBeCloseTo(0, 4)
    expect(r.t).toBeCloseTo(0.7, 2)
  })

  it('punto más allá del extremo inicial → clampa al inicio (t≈0)', () => {
    const r = projectOntoPath(path as SVGPathElement, { x: -50, y: 10 })
    expect(r.t).toBeCloseTo(0, 2)
    expect(r.point.x).toBeCloseTo(0, 1)
  })

  it('punto más allá del extremo final → clampa al final (t≈1)', () => {
    const r = projectOntoPath(path as SVGPathElement, { x: 500, y: 10 })
    expect(r.t).toBeCloseTo(1, 2)
    expect(r.point.x).toBeCloseTo(100, 1)
  })

  it('proyecta sobre una curva (semicírculo): el punto más alto cae en t=0.5', () => {
    const arc = semicirclePath(0, 0, 50) // cima en (0, -50) a media longitud
    const r = projectOntoPath(arc as SVGPathElement, { x: 0, y: -100 })
    expect(r.t).toBeCloseTo(0.5, 2)
    expect(r.point.x).toBeCloseTo(0, 1)
    expect(r.point.y).toBeCloseTo(-50, 1)
  })

  it('proyección sobre curva: extremo derecho del semicírculo (t≈1)', () => {
    const arc = semicirclePath(0, 0, 50) // termina en (50, 0)
    const r = projectOntoPath(arc as SVGPathElement, { x: 80, y: 0 })
    expect(r.t).toBeCloseTo(1, 2)
    expect(r.point.x).toBeCloseTo(50, 1)
    expect(r.point.y).toBeCloseTo(0, 1)
  })
})
