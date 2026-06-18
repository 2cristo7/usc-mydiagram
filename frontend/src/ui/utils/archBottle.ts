// Geometría de la silueta "botella" de los nodos de arquitectura (archIcon):
// la unión de la caja del icono (cuadrado, arriba) con la caja del texto
// (variable, debajo). Es la forma del anillo de selección Y la hitbox sobre la
// que se anclan los extremos de las aristas. Compartida por ArchIconNode (la
// dibuja) y getFloatingAnchor/anchorPointOnShape (interseccionan un rayo con
// ella para colocar el extremo).
//
// Sistema de coordenadas: ROOT-LOCAL = origen en la esquina superior izquierda
// de la caja medida por React Flow (el cuadrado del icono, ICON_BOX×ICON_BOX).
// El icono ocupa [0,ICON_BOX]×[0,ICON_BOX]; el texto cuelga debajo, centrado en
// el eje X del icono, y puede sobresalir lateralmente (x<0 ó x>ICON_BOX).
import type { Node } from '@xyflow/react'
import { getArchTextSize } from '../../store/archGeom'

export type Pt = { x: number; y: number }

// Constantes (deben coincidir con el render de ArchIconNode).
export const ARCH_ICON_VIS = 64                       // lado del SVG del icono
export const ARCH_PAD = 4                             // holgura contenido ↔ trazo
export const ARCH_GAP = 10                            // separación icono ↔ texto
export const ARCH_ICON_BOX = ARCH_ICON_VIS + 2 * ARCH_PAD // 72 = caja medida (RF)

export function isArchBottle(node: Node): boolean {
  return node.type === 'archIcon'
}

// Centro del icono en ROOT-LOCAL: centro de la caja medida (cuadrado 72×72).
// Es el origen del rayo de anclaje, así un edge horizontal aterriza a media
// altura del icono (cuello) y uno que viene de abajo, en el cuerpo del texto.
export function archIconCenterLocal(): Pt {
  return { x: ARCH_ICON_BOX / 2, y: ARCH_ICON_BOX / 2 }
}

// Polígono (sin redondear) de la silueta botella en ROOT-LOCAL, a partir del
// tamaño de la caja de texto (Wt×Ht). Sin texto medido → solo el icono.
export function archBottlePolygon(Wt: number, Ht: number): Pt[] {
  const IB = ARCH_ICON_BOX
  const cx = IB / 2
  // Caja del icono = caja medida completa.
  const ax0 = 0, ax1 = IB, ay0 = 0, ay1 = IB
  const iconOnly: Pt[] = [
    { x: ax0, y: ay0 }, { x: ax1, y: ay0 },
    { x: ax1, y: ay1 }, { x: ax0, y: ay1 },
  ]
  if (Wt <= 0 || Ht <= 0) return iconOnly

  const TW = Wt + 2 * ARCH_PAD
  const TH = Ht + 2 * ARCH_PAD
  // Borde superior de la caja de texto en ROOT-LOCAL: el texto visual empieza en
  // ARCH_PAD + ICON_VIS + GAP y la hitbox sube ARCH_PAD por encima → ICON_VIS+GAP.
  const ty0 = ARCH_ICON_VIS + ARCH_GAP
  const ty1 = ty0 + TH
  const tx0 = cx - TW / 2
  const tx1 = cx + TW / 2

  // Texto más ancho que el icono (caso normal): cuello arriba, cuerpo abajo.
  if (TW >= IB) {
    return [
      { x: ax0, y: ay0 }, { x: ax1, y: ay0 },
      { x: ax1, y: ty0 }, { x: tx1, y: ty0 },
      { x: tx1, y: ty1 }, { x: tx0, y: ty1 },
      { x: tx0, y: ty0 }, { x: ax0, y: ty0 },
    ]
  }
  // Texto más estrecho que el icono (etiquetas muy cortas): escalón hacia dentro.
  return [
    { x: ax0, y: ay0 }, { x: ax1, y: ay0 },
    { x: ax1, y: ay1 }, { x: tx1, y: ay1 },
    { x: tx1, y: ty1 }, { x: tx0, y: ty1 },
    { x: tx0, y: ay1 }, { x: ax0, y: ay1 },
  ]
}

// Polígono de la botella de un nodo concreto (lee su tamaño de texto del store).
export function archBottlePolygonForNode(node: Node): Pt[] {
  const { w, h } = getArchTextSize(node.id)
  return archBottlePolygon(w, h)
}

// Caja envolvente (bounding box) de la silueta botella en ROOT-LOCAL, a partir
// del tamaño de la caja de texto (Wt×Ht). Es el footprint REAL del nodo (icono +
// texto), no solo el icono 72×72 que mide React Flow. El ruteo de aristas lo usa
// como obstáculo y para elegir lados, de modo que las líneas rodeen el texto en
// vez de cruzarlo. Sin texto medido → la caja del icono.
export function archFootprintLocalBounds(
  Wt: number,
  Ht: number,
): { left: number; right: number; top: number; bottom: number } {
  const IB = ARCH_ICON_BOX
  if (Wt <= 0 || Ht <= 0) return { left: 0, right: IB, top: 0, bottom: IB }
  const cx = IB / 2
  const TW = Wt + 2 * ARCH_PAD
  const TH = Ht + 2 * ARCH_PAD
  const ty1 = ARCH_ICON_VIS + ARCH_GAP + TH
  return {
    left: Math.min(0, cx - TW / 2),
    right: Math.max(IB, cx + TW / 2),
    top: 0,
    bottom: Math.max(IB, ty1),
  }
}

// Intersección del rayo `origin + t·dir` (t>0) con el polígono. Con `origin`
// dentro del polígono, devuelve el primer cruce de frontera hacia fuera (el
// punto de la silueta por el que sale el rayo). Si no cruza, devuelve `origin`.
export function rayIntersectPolygon(origin: Pt, dir: Pt, poly: Pt[]): Pt {
  let bestT = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const ex = b.x - a.x
    const ey = b.y - a.y
    const denom = dir.x * ey - dir.y * ex
    if (Math.abs(denom) < 1e-9) continue // paralelos
    const ax = a.x - origin.x
    const ay = a.y - origin.y
    const t = (ax * ey - ay * ex) / denom
    const s = (ax * dir.y - ay * dir.x) / denom
    if (t > 1e-9 && s >= -1e-9 && s <= 1 + 1e-9 && t < bestT) bestT = t
  }
  if (!Number.isFinite(bestT)) return { x: origin.x, y: origin.y }
  return { x: origin.x + dir.x * bestT, y: origin.y + dir.y * bestT }
}
