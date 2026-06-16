import { Position, type Node } from '@xyflow/react'
import { absPos, anchorPointOnShape } from './getFloatingAnchor'

type Point = { x: number; y: number }

function dims(node: Node): { w: number; h: number } {
  return {
    w: node.measured?.width ?? node.width ?? 100,
    h: node.measured?.height ?? node.height ?? 40,
  }
}

// Punto absoluto en coordenadas de flujo a partir de un anclaje normalizado
// [0..1] relativo a la caja del nodo. Como es relativo, sobrevive a mover y
// redimensionar el nodo: el extremo se queda en el mismo punto del borde.
// Se proyecta sobre el contorno VISIBLE de la forma (cápsula, círculo, rombo,
// rect redondeado), no sobre la caja envolvente, así el extremo deslizable se
// pega al borde dibujado y no flota en las esquinas vacías de la caja.
export function getAnchorPoint(node: Node, anchor: Point): Point {
  return anchorPointOnShape(node, anchor)
}

// Proyecta un punto en coordenadas de flujo sobre el perímetro del nodo y lo
// devuelve como anclaje normalizado [0..1]. El punto se clampa a la caja y se
// pega al borde más cercano: así el extremo desliza a lo largo del ancho/alto
// del nodo (comportamiento estilo MIRO) sin despegarse del borde.
export function projectToNodePerimeter(node: Node, flowPt: Point): Point {
  const p = absPos(node)
  const { w, h } = dims(node)
  let lx = Math.max(0, Math.min(w, flowPt.x - p.x))
  let ly = Math.max(0, Math.min(h, flowPt.y - p.y))
  const dLeft = lx
  const dRight = w - lx
  const dTop = ly
  const dBottom = h - ly
  const min = Math.min(dLeft, dRight, dTop, dBottom)
  if (min === dLeft) lx = 0
  else if (min === dRight) lx = w
  else if (min === dTop) ly = 0
  else ly = h
  return { x: w ? lx / w : 0.5, y: h ? ly / h : 0.5 }
}

// Proyecta un punto sobre UN lado concreto del nodo (no el más cercano). Se usa
// al deslizar un extremo: se fija el lado al empezar el arrastre y se desliza a
// lo largo de él, evitando que el extremo "salte" de borde cerca de las esquinas.
export function projectOntoSide(node: Node, side: Position, flowPt: Point): Point {
  const p = absPos(node)
  const { w, h } = dims(node)
  const lx = Math.max(0, Math.min(w, flowPt.x - p.x))
  const ly = Math.max(0, Math.min(h, flowPt.y - p.y))
  const nx = w ? lx / w : 0.5
  const ny = h ? ly / h : 0.5
  if (side === Position.Left) return { x: 0, y: ny }
  if (side === Position.Right) return { x: 1, y: ny }
  if (side === Position.Top) return { x: nx, y: 0 }
  return { x: nx, y: 1 } // Bottom
}

// Lado del nodo en el que cae un anclaje normalizado (uno de sus ejes está en
// 0 o 1 porque el punto vive en el perímetro). Lo usa el routing smoothstep de
// arquitectura para salir/entrar por la dirección correcta.
export function anchorToPosition(anchor: Point): Position {
  if (anchor.x <= 0) return Position.Left
  if (anchor.x >= 1) return Position.Right
  if (anchor.y <= 0) return Position.Top
  return Position.Bottom
}
