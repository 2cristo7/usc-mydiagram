import { Position, type Node } from '@xyflow/react'

type AnchorResult = {
  x: number
  y: number
  position: Position
}

// Posición absoluta del nodo: los nodos internos de React Flow exponen
// `internals.positionAbsolute` (correcta incluso para nodos hijos/anidados);
// caemos a `position` para nodos planos o llamadas con nodos no-internos.
function absPos(node: Node): { x: number; y: number } {
  const internals = (node as unknown as { internals?: { positionAbsolute?: { x: number; y: number } } }).internals
  return internals?.positionAbsolute ?? node.position
}

export function getFloatingAnchor(node: Node, otherNode: Node): AnchorResult {
  const np = absPos(node)
  const op = absPos(otherNode)
  const nx = np.x + (node.measured?.width ?? node.width ?? 100) / 2
  const ny = np.y + (node.measured?.height ?? node.height ?? 40) / 2
  const ox = op.x + (otherNode.measured?.width ?? otherNode.width ?? 100) / 2
  const oy = op.y + (otherNode.measured?.height ?? otherNode.height ?? 40) / 2

  const w = (node.measured?.width ?? node.width ?? 100) / 2
  const h = (node.measured?.height ?? node.height ?? 40) / 2

  const dx = ox - nx
  const dy = oy - ny

  const absDx = Math.abs(dx)
  const absDy = Math.abs(dy)

  // Use aspect ratio to determine if intersection is on horizontal or vertical edge
  if (absDx / w > absDy / h) {
    // Intersects left or right edge
    const side = dx > 0 ? 1 : -1
    const clampedY = Math.max(-h, Math.min(h, (dy / absDx) * w))
    return {
      x: nx + side * w,
      y: ny + clampedY,
      position: dx > 0 ? Position.Right : Position.Left,
    }
  } else {
    // Intersects top or bottom edge
    const side = dy > 0 ? 1 : -1
    const clampedX = Math.max(-w, Math.min(w, (dx / absDy) * h))
    return {
      x: nx + clampedX,
      y: ny + side * h,
      position: dy > 0 ? Position.Bottom : Position.Top,
    }
  }
}
