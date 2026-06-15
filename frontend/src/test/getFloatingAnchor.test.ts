import { describe, it, expect } from 'vitest'
import { Position } from '@xyflow/react'
import { getFloatingAnchor } from '../ui/utils/getFloatingAnchor'
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

  it('nodes at same position → does not crash and returns a valid position', () => {
    const node = makeNode(0, 0)
    const other = makeNode(0, 0)
    // dx=0, dy=0 → falls into else branch (0/h === 0/w), returns Top or Bottom
    expect(() => getFloatingAnchor(node, other)).not.toThrow()
    const result = getFloatingAnchor(node, other)
    expect(Object.values(Position)).toContain(result.position)
  })
})
