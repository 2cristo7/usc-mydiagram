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

  it('nodes at same position → does not crash and returns a valid position', () => {
    const node = makeNode(0, 0)
    const other = makeNode(0, 0)
    // dx=0, dy=0 → falls into else branch (0/h === 0/w), returns Top or Bottom
    expect(() => getFloatingAnchor(node, other)).not.toThrow()
    const result = getFloatingAnchor(node, other)
    expect(Object.values(Position)).toContain(result.position)
  })
})
