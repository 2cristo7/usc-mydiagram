import { describe, it, expect } from 'vitest'
import { Position, type Node } from '@xyflow/react'
import {
  getAnchorPoint,
  projectToNodePerimeter,
  projectOntoSide,
  anchorToPosition,
} from '../ui/utils/getNodeAnchor'

// Nodo rectangular mínimo en (x,y) con medidas dadas. Sin `data.nodeType` ni
// type especial → el contorno es la caja redondeada (radio 4px en el centro de
// los lados es indistinguible de la caja, así los valores en los ejes son exactos).
function makeNode(x: number, y: number, width = 100, height = 40): Node {
  return {
    id: 'n',
    position: { x, y },
    data: {},
    measured: { width, height },
  } as Node
}

describe('projectToNodePerimeter', () => {
  it('pega al borde IZQUIERDO el punto más cercano a la izquierda', () => {
    const node = makeNode(0, 0, 100, 40)
    // Punto cerca del lado izquierdo (lx=10 de 100): el lado más próximo es Left.
    const a = projectToNodePerimeter(node, { x: 10, y: 20 })
    expect(a.x).toBe(0)
    expect(a.y).toBeCloseTo(0.5) // 20/40
  })

  it('pega al borde DERECHO un punto cercano a la derecha', () => {
    const node = makeNode(0, 0, 100, 40)
    const a = projectToNodePerimeter(node, { x: 95, y: 20 })
    expect(a.x).toBe(1) // lx = 100 → x = 100/100
    expect(a.y).toBeCloseTo(0.5)
  })

  it('pega al borde SUPERIOR un punto cercano arriba', () => {
    const node = makeNode(0, 0, 100, 40)
    // lx=50 (centro), ly=5 → top es el más próximo (dTop=5).
    const a = projectToNodePerimeter(node, { x: 50, y: 5 })
    expect(a.y).toBe(0)
    expect(a.x).toBeCloseTo(0.5)
  })

  it('pega al borde INFERIOR un punto cercano abajo', () => {
    const node = makeNode(0, 0, 100, 40)
    const a = projectToNodePerimeter(node, { x: 50, y: 38 })
    expect(a.y).toBe(1) // ly = 40 → 40/40
    expect(a.x).toBeCloseTo(0.5)
  })

  it('clampa puntos FUERA de la caja al perímetro', () => {
    const node = makeNode(0, 0, 100, 40)
    // Muy a la izquierda y arriba: lx clampa a 0 (left), dLeft=0 gana.
    const a = projectToNodePerimeter(node, { x: -500, y: -500 })
    expect(a.x).toBe(0)
    expect(a.y).toBe(0) // ly clampa a 0
  })

  it('respeta el desplazamiento del nodo (coordenadas de flujo)', () => {
    const node = makeNode(200, 100, 100, 40)
    // flowPt - pos = (10, 20) → cerca del borde izquierdo.
    const a = projectToNodePerimeter(node, { x: 210, y: 120 })
    expect(a.x).toBe(0)
    expect(a.y).toBeCloseTo(0.5)
  })

  it('nodo de tamaño cero → anclaje al centro (0.5, 0.5)', () => {
    const node = makeNode(0, 0, 0, 0)
    const a = projectToNodePerimeter(node, { x: 0, y: 0 })
    expect(a.x).toBe(0.5)
    expect(a.y).toBe(0.5)
  })
})

describe('projectOntoSide', () => {
  const node = makeNode(0, 0, 100, 40)

  it('lado LEFT fija x=0 y conserva la fracción vertical', () => {
    const a = projectOntoSide(node, Position.Left, { x: 80, y: 10 })
    expect(a.x).toBe(0)
    expect(a.y).toBeCloseTo(0.25) // 10/40
  })

  it('lado RIGHT fija x=1', () => {
    const a = projectOntoSide(node, Position.Right, { x: 80, y: 30 })
    expect(a.x).toBe(1)
    expect(a.y).toBeCloseTo(0.75)
  })

  it('lado TOP fija y=0 y conserva la fracción horizontal', () => {
    const a = projectOntoSide(node, Position.Top, { x: 25, y: 80 })
    expect(a.y).toBe(0)
    expect(a.x).toBeCloseTo(0.25)
  })

  it('lado BOTTOM fija y=1 (rama por defecto)', () => {
    const a = projectOntoSide(node, Position.Bottom, { x: 75, y: -80 })
    expect(a.y).toBe(1)
    expect(a.x).toBeCloseTo(0.75)
  })

  it('clampa la coordenada deslizante a [0,1]', () => {
    const a = projectOntoSide(node, Position.Left, { x: 0, y: 9999 })
    expect(a.x).toBe(0)
    expect(a.y).toBe(1) // ly clampa al alto
  })

  it('nodo de tamaño cero → fracción 0.5 en el eje deslizante', () => {
    const z = makeNode(0, 0, 0, 0)
    const a = projectOntoSide(z, Position.Top, { x: 5, y: 5 })
    expect(a.y).toBe(0)
    expect(a.x).toBe(0.5)
  })
})

describe('anchorToPosition', () => {
  it('x<=0 → Left', () => {
    expect(anchorToPosition({ x: 0, y: 0.5 })).toBe(Position.Left)
  })
  it('x>=1 → Right', () => {
    expect(anchorToPosition({ x: 1, y: 0.5 })).toBe(Position.Right)
  })
  it('y<=0 (con x en el interior) → Top', () => {
    expect(anchorToPosition({ x: 0.5, y: 0 })).toBe(Position.Top)
  })
  it('y>=1 (resto) → Bottom', () => {
    expect(anchorToPosition({ x: 0.5, y: 1 })).toBe(Position.Bottom)
  })
  it('Left tiene prioridad sobre Top cuando ambos ejes están en 0 (esquina)', () => {
    expect(anchorToPosition({ x: 0, y: 0 })).toBe(Position.Left)
  })
  it('Right tiene prioridad sobre Bottom en la esquina inferior derecha', () => {
    expect(anchorToPosition({ x: 1, y: 1 })).toBe(Position.Right)
  })
})

describe('getAnchorPoint (delega en anchorPointOnShape)', () => {
  it('anclaje DERECHO de una caja → borde derecho a media altura', () => {
    const node = makeNode(0, 0, 100, 40)
    // Anchor (1, 0.5): dirección desde el centro hacia la derecha → borde x=100.
    const p = getAnchorPoint(node, { x: 1, y: 0.5 })
    expect(p.x).toBeCloseTo(100)
    expect(p.y).toBeCloseTo(20)
  })

  it('anclaje SUPERIOR → borde superior, centrado en x', () => {
    const node = makeNode(0, 0, 100, 40)
    const p = getAnchorPoint(node, { x: 0.5, y: 0 })
    expect(p.x).toBeCloseTo(50)
    expect(p.y).toBeCloseTo(0)
  })

  it('anclaje en el centro exacto devuelve el centro (sin dirección)', () => {
    const node = makeNode(0, 0, 100, 40)
    const p = getAnchorPoint(node, { x: 0.5, y: 0.5 })
    expect(p.x).toBeCloseTo(50)
    expect(p.y).toBeCloseTo(20)
  })

  it('respeta el offset del nodo', () => {
    const node = makeNode(200, 100, 100, 40)
    const p = getAnchorPoint(node, { x: 1, y: 0.5 })
    expect(p.x).toBeCloseTo(300)
    expect(p.y).toBeCloseTo(120)
  })
})
