import { describe, it, expect } from 'vitest'
import { Position } from '@xyflow/react'
import { getFloatingAnchor, anchorPointOnShape } from '../ui/utils/getFloatingAnchor'
import type { Node } from '@xyflow/react'

function makeNode(x: number, y: number, width = 100, height = 40): Node {
  return {
    id: 'n',
    position: { x, y },
    data: {},
    measured: { width, height },
  } as Node
}

function makeDiamond(x: number, y: number, size = 128): Node {
  return {
    id: 'd',
    position: { x, y },
    data: { nodeType: 'decision' },
    measured: { width: size, height: size },
  } as Node
}

describe('getFloatingAnchor', () => {
  it('other node to the right → returns Position.Right', () => {
    const node = makeNode(0, 0)
    const other = makeNode(200, 0)
    const result = getFloatingAnchor(node, other)
    expect(result.position).toBe(Position.Right)
    expect(result.x).toBe(100) // node center x (50) + half-width (50) = right edge
  })

  it('other node above → returns Position.Top', () => {
    const node = makeNode(0, 200)
    const other = makeNode(0, 0)
    const result = getFloatingAnchor(node, other)
    expect(result.position).toBe(Position.Top)
    expect(result.y).toBe(200) // node center y - half-height
  })

  it('other node below-left at shallow angle → returns Position.Left', () => {
    // dx=-300, dy=20 → absDx/w=6, absDy/h=1 → horizontal wins → Left
    const node = makeNode(300, 0)
    const other = makeNode(0, 20)
    const result = getFloatingAnchor(node, other)
    expect(result.position).toBe(Position.Left)
  })

  it('other node below-left at steep angle → returns Position.Bottom', () => {
    // dx=-20, dy=300 → absDx/w=0.4, absDy/h=15 → vertical wins → Bottom
    const node = makeNode(20, 0)
    const other = makeNode(0, 300)
    const result = getFloatingAnchor(node, other)
    expect(result.position).toBe(Position.Bottom)
  })

  it('decision node, other to the right → lands on the right vertex of the diamond', () => {
    const node = makeDiamond(0, 0) // center (64,64), vertices touch box-side midpoints
    const other = makeNode(400, 64 - 20) // a la derecha, casi a la misma altura
    const result = getFloatingAnchor(node, other)
    expect(result.position).toBe(Position.Right)
    expect(result.x).toBeCloseTo(128) // vértice derecho del rombo, no la esquina de la caja
    expect(result.y).toBeCloseTo(64)
  })

  it('decision node, other diagonal down-right → lands on the slanted edge, not the box corner', () => {
    const node = makeDiamond(0, 0)
    const other = makeNode(564, 564) // centro en (614,584): dx≈dy desde (64,64)
    const result = getFloatingAnchor(node, other)
    // punto medio de la arista vértice-derecho→vértice-inferior: (96,96)
    expect(result.x).toBeLessThan(128) // dentro del rombo, lejos de la esquina (128,128)
    expect(result.y).toBeLessThan(128)
    // sobre el perímetro del rombo: |x-64|/64 + |y-64|/64 === 1
    expect(Math.abs(result.x - 64) / 64 + Math.abs(result.y - 64) / 64).toBeCloseTo(1)
  })

  it('pill (mindmap) node, other diagonal → lands on the rounded border, inside the box corner', () => {
    // Cápsula 120x40 centrada en (60,20): radio = min(120,40)/2 = 20 (extremos circulares).
    const pill = {
      id: 'p',
      position: { x: 0, y: 0 },
      type: 'mindmap',
      data: { role: 'leaf' },
      measured: { width: 120, height: 40 },
    } as unknown as Node
    const other = makeNode(400, 20) // a la derecha y ligeramente abajo → sale por el extremo
    const result = getFloatingAnchor(pill, other)
    // El extremo semicircular derecho es un arco de radio 20 centrado en (100,20)
    // (el borde recto solo cubre la franja central; los extremos son círculos).
    expect(Math.hypot(result.x - 100, result.y - 20)).toBeCloseTo(20)
    expect(result.x).toBeLessThan(120) // nunca llega a la esquina de la caja
  })

  it('circular state (initial), other to the right → lands on the circle, not the box edge', () => {
    const circle = {
      id: 's',
      position: { x: 0, y: 0 },
      type: 'state',
      data: { label: 'start' },
      measured: { width: 40, height: 40 },
    } as unknown as Node
    const other = makeNode(400, 60) // ligeramente abajo a la derecha
    const result = getFloatingAnchor(circle, other)
    // Debe quedar sobre el círculo de radio 20 centrado en (20,20).
    expect(Math.hypot(result.x - 20, result.y - 20)).toBeCloseTo(20)
  })

  it('nodes at same position → does not crash and returns a valid position', () => {
    const node = makeNode(0, 0)
    const other = makeNode(0, 0)
    // dx=0, dy=0 → falls into else branch (0/h === 0/w), returns Top or Bottom
    expect(() => getFloatingAnchor(node, other)).not.toThrow()
    const result = getFloatingAnchor(node, other)
    expect(Object.values(Position)).toContain(result.position)
  })
})

describe('anchorPointOnShape', () => {
  it('left-edge midpoint of a pill → its leftmost tip on the box edge', () => {
    // Píldora 120x40 en (0,0): el centro del lado izquierdo SÍ toca la caja.
    const pill = {
      id: 'p',
      position: { x: 0, y: 0 },
      type: 'flow',
      data: { nodeType: 'terminator' },
      measured: { width: 120, height: 40 },
    } as unknown as Node
    const pt = anchorPointOnShape(pill, { x: 0, y: 0.5 })
    expect(pt.x).toBeCloseTo(0)
    expect(pt.y).toBeCloseTo(20)
  })

  it('left-edge anchor OFF the midpoint of a pill → hugs the rounded cap, not the box', () => {
    // Reproduce la captura: el extremo fijo se desliza a y≈0.15 del lado izquierdo.
    // El borde visible ahí está MUY adentro de la esquina de la caja (x≫0).
    const pill = {
      id: 'p',
      position: { x: 0, y: 0 },
      type: 'flow',
      data: { nodeType: 'terminator' },
      measured: { width: 120, height: 40 },
    } as unknown as Node
    const pt = anchorPointOnShape(pill, { x: 0, y: 0.15 })
    // El extremo izquierdo es un semicírculo de radio 20 centrado en (20,20).
    expect(Math.hypot(pt.x - 20, pt.y - 20)).toBeCloseTo(20)
    expect(pt.x).toBeGreaterThan(0) // ya NO en el borde de la caja → no flota fuera
  })

  it('top-left box anchor of a diamond → lands on the slanted edge, not the empty corner', () => {
    const diamond = makeDiamond(0, 0) // 128x128, centro (64,64)
    const pt = anchorPointOnShape(diamond, { x: 0, y: 0 })
    // Sobre el perímetro del rombo: |x-64|/64 + |y-64|/64 === 1
    expect(Math.abs(pt.x - 64) / 64 + Math.abs(pt.y - 64) / 64).toBeCloseTo(1)
    expect(pt.x).toBeGreaterThan(0) // no en la esquina vacía (0,0) de la caja
    expect(pt.y).toBeGreaterThan(0)
  })

  it('rectangular node anchor → maps to the box edge (radius 4 ≈ flush)', () => {
    const rect = makeNode(0, 0, 100, 40) // tabla/UML, rounded 4px
    const pt = anchorPointOnShape(rect, { x: 1, y: 0.5 })
    expect(pt.x).toBeCloseTo(100) // borde derecho
    expect(pt.y).toBeCloseTo(20)
  })
})
