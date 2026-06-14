import { describe, it, expect } from 'vitest'
import { getWaypointPath } from '../ui/utils/getWaypointPath'

const src = { x: 0, y: 0 }
const tgt = { x: 100, y: 100 }
const wp1 = { x: 50, y: 20 }
const wp2 = { x: 30, y: 80 }

function isFiniteCoords(lx: number, ly: number) {
  return Number.isFinite(lx) && Number.isFinite(ly)
}

// ---------------------------------------------------------------------------
// straight
// ---------------------------------------------------------------------------

describe('getWaypointPath — straight', () => {
  it('0 waypoints: M + single L, finite label', () => {
    const [path, lx, ly] = getWaypointPath(src, tgt, [], 'straight')
    expect(path).toMatch(/^M /)
    expect(path).toContain('L ')
    expect(isFiniteCoords(lx, ly)).toBe(true)
  })

  it('1 waypoint: contains 2 L commands', () => {
    const [path, lx, ly] = getWaypointPath(src, tgt, [wp1], 'straight')
    const lCount = (path.match(/\bL /g) ?? []).length
    expect(lCount).toBe(2)
    expect(isFiniteCoords(lx, ly)).toBe(true)
  })

  it('2 waypoints: contains 3 L commands', () => {
    const [path, lx, ly] = getWaypointPath(src, tgt, [wp1, wp2], 'straight')
    const lCount = (path.match(/\bL /g) ?? []).length
    expect(lCount).toBe(3)
    expect(isFiniteCoords(lx, ly)).toBe(true)
  })

  it('label is midpoint of path', () => {
    // for a horizontal line the mid-x should be 50
    const [, lx, ly] = getWaypointPath({ x: 0, y: 0 }, { x: 100, y: 0 }, [], 'straight')
    expect(lx).toBeCloseTo(50)
    expect(ly).toBeCloseTo(0)
  })
})

// ---------------------------------------------------------------------------
// elbow
// ---------------------------------------------------------------------------

describe('getWaypointPath — elbow', () => {
  it('0 waypoints: M + L commands with axis-aligned coords', () => {
    const [path, lx, ly] = getWaypointPath(src, tgt, [], 'elbow')
    expect(path).toMatch(/^M /)
    expect(path).toContain('L ')
    expect(isFiniteCoords(lx, ly)).toBe(true)
  })

  it('0 waypoints: intermediate point shares x with target or y with source', () => {
    const [path] = getWaypointPath({ x: 0, y: 0 }, { x: 100, y: 50 }, [], 'elbow')
    // elbow bend: after M 0 0 the first L should have x=100 or y=0
    const tokens = path.split(' ')
    // tokens: M 0 0 L <x> <y> L <x> <y>
    // first L at index 3: x=tokens[4], y=tokens[5]
    const bendX = parseFloat(tokens[4])
    const bendY = parseFloat(tokens[5])
    const isAxisAligned = bendX === 100 || bendY === 0
    expect(isAxisAligned).toBe(true)
  })

  it('1 waypoint: finite label', () => {
    const [path, lx, ly] = getWaypointPath(src, tgt, [wp1], 'elbow')
    expect(path).toMatch(/^M /)
    expect(isFiniteCoords(lx, ly)).toBe(true)
  })

  it('2 waypoints: finite label', () => {
    const [path, lx, ly] = getWaypointPath(src, tgt, [wp1, wp2], 'elbow')
    expect(path).toMatch(/^M /)
    expect(isFiniteCoords(lx, ly)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// curved
// ---------------------------------------------------------------------------

describe('getWaypointPath — curved', () => {
  it('0 waypoints: cubic bezier C command', () => {
    const [path, lx, ly] = getWaypointPath(src, tgt, [], 'curved')
    expect(path).toMatch(/^M /)
    expect(path).toContain('C ')
    expect(isFiniteCoords(lx, ly)).toBe(true)
  })

  it('1 waypoint: C command present, finite label', () => {
    const [path, lx, ly] = getWaypointPath(src, tgt, [wp1], 'curved')
    expect(path).toContain('C ')
    expect(isFiniteCoords(lx, ly)).toBe(true)
  })

  it('2 waypoints: multiple C commands', () => {
    const [path, lx, ly] = getWaypointPath(src, tgt, [wp1, wp2], 'curved')
    const cCount = (path.match(/\bC /g) ?? []).length
    expect(cCount).toBeGreaterThanOrEqual(2)
    expect(isFiniteCoords(lx, ly)).toBe(true)
  })

  it('0 waypoints horizontal: label near midpoint', () => {
    const [, lx, ly] = getWaypointPath({ x: 0, y: 0 }, { x: 100, y: 0 }, [], 'curved')
    expect(lx).toBeCloseTo(50, 0)
    expect(ly).toBeCloseTo(0, 0)
  })
})
