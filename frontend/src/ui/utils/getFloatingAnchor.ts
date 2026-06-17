import { Position, type Node } from '@xyflow/react'
import {
  archBottlePolygonForNode,
  archIconCenterLocal,
  isArchBottle,
  rayIntersectPolygon,
} from './archBottle'

type AnchorResult = {
  x: number
  y: number
  position: Position
}

// Centro de referencia (en flujo) desde el que se traza el rayo de anclaje. Para
// los nodos archIcon es el centro del ICONO (no el de la caja envolvente), de
// modo que las aristas horizontales toquen el cuello a media altura del icono.
function rayCenter(node: Node): { x: number; y: number } {
  const p = absPos(node)
  if (isArchBottle(node)) {
    const c = archIconCenterLocal()
    return { x: p.x + c.x, y: p.y + c.y }
  }
  const w = node.measured?.width ?? node.width ?? 100
  const h = node.measured?.height ?? node.height ?? 40
  return { x: p.x + w / 2, y: p.y + h / 2 }
}

// Lado dominante de salida/entrada a partir de la dirección del rayo (icono
// cuadrado → comparación simétrica).
function sideFromDir(dx: number, dy: number): Position {
  return Math.abs(dx) >= Math.abs(dy)
    ? dx > 0 ? Position.Right : Position.Left
    : dy > 0 ? Position.Bottom : Position.Top
}

// Posición absoluta del nodo: los nodos internos de React Flow exponen
// `internals.positionAbsolute` (correcta incluso para nodos hijos/anidados);
// caemos a `position` para nodos planos o llamadas con nodos no-internos.
export function absPos(node: Node): { x: number; y: number } {
  const internals = (node as unknown as { internals?: { positionAbsolute?: { x: number; y: number } } }).internals
  return internals?.positionAbsolute ?? node.position
}

// Un nodo de decisión se dibuja como un rombo inscrito en su caja (cuadrado
// rotado 45°), así que sus vértices tocan los puntos medios de los lados de la
// caja y sus aristas son diagonales. Intersecar con la caja dejaría el extremo
// en los triángulos vacíos de las esquinas; hay que intersecar con el rombo.
function isDiamond(node: Node): boolean {
  return (node.data as { nodeType?: string } | undefined)?.nodeType === 'decision'
}

// Radio de las esquinas del nodo en px (sobre dimensiones completas). Permite
// que el extremo de la arista se pegue al borde redondeado real —cápsula,
// círculo, esquina suave— en lugar de a la caja rectangular envolvente.
function cornerRadius(node: Node, fullW: number, fullH: number): number {
  const data = node.data as
    | { nodeType?: string; role?: string; label?: string }
    | undefined
  const cap = Math.min(fullW, fullH) / 2 // radio que llena el eje corto (cápsula/círculo)

  // Cápsulas / píldoras (borderRadius: 9999): mindmap y terminadores de flujo.
  if (node.type === 'mindmap') return cap
  if (node.type === 'flow' && data?.nodeType === 'terminator') return cap

  // Estados inicial/final: se dibujan como círculos.
  if (node.type === 'state') {
    const label = (data?.label ?? '').trim()
    if (/^(start|inicio|initial|end|fin|final)$/i.test(label)) return cap
    return 12 // estado normal: rounded 12px
  }

  // Resto (tablas, UML, C4, arquitectura, proceso de flujo): rounded var(--radius) = 4px.
  return 4
}

// Intersección del rayo centro→exterior (dirección dx,dy) con un rectángulo
// redondeado de semiejes w,h y radio de esquina r. Devuelve el offset desde el
// centro. Si el rayo sale por una esquina se interseca con el arco de círculo
// de esa esquina; si sale por un tramo recto, con el lado del rectángulo. Con
// r=0 degenera en la intersección rectangular clásica.
function intersectRoundedRect(
  w: number,
  h: number,
  r: number,
  dx: number,
  dy: number,
): { x: number; y: number } {
  const rr = Math.max(0, Math.min(r, w, h))
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)

  // Intersección con la caja rectangular (el rayo toca un lado completo).
  const tx = adx > 0 ? w / adx : Infinity
  const ty = ady > 0 ? h / ady : Infinity
  const t = Math.min(tx, ty)
  let px = dx * t
  let py = dy * t

  // Centro del círculo de la esquina hacia la que apunta el rayo.
  const cx = w - rr
  const cy = h - rr

  // Si el punto rectangular cae más allá de los tramos rectos (zona de esquina),
  // recalcular contra el arco de esa esquina.
  if (rr > 0 && Math.abs(px) > cx && Math.abs(py) > cy) {
    const ccx = Math.sign(px) * cx
    const ccy = Math.sign(py) * cy
    const a = dx * dx + dy * dy
    const b = -2 * (dx * ccx + dy * ccy)
    const c = ccx * ccx + ccy * ccy - rr * rr
    const disc = b * b - 4 * a * c
    if (a > 0 && disc >= 0) {
      const tCorner = (-b + Math.sqrt(disc)) / (2 * a) // intersección exterior
      px = dx * tCorner
      py = dy * tCorner
    }
  }

  return { x: px, y: py }
}

// Dado un anclaje normalizado [0..1] sobre la CAJA del nodo (un eje en 0/1, por
// vivir en el perímetro de la caja), devuelve el punto absoluto sobre el contorno
// VISIBLE de la forma: cápsula, círculo, rombo o rectángulo redondeado. El
// anclaje se interpreta como dirección centro→borde y se interseca con la forma
// real —exactamente como el anclaje flotante de las aristas conectadas—, de modo
// que el extremo se pega al borde dibujado y no a las esquinas vacías de la caja
// envolvente. Imprescindible para que el extremo deslizable de una arista no
// quede flotando fuera de una píldora o un rombo.
export function anchorPointOnShape(node: Node, anchor: { x: number; y: number }): { x: number; y: number } {
  const p = absPos(node)
  const fullW = node.measured?.width ?? node.width ?? 100
  const fullH = node.measured?.height ?? node.height ?? 40

  // archIcon: el anclaje (normalizado sobre la caja del icono) se interpreta como
  // dirección desde el centro del icono y se interseca con la silueta botella, así
  // el extremo se pega al contorno real (cuello del icono o cuerpo del texto).
  if (isArchBottle(node)) {
    const poly = archBottlePolygonForNode(node)
    const origin = archIconCenterLocal()
    const dir = { x: anchor.x * fullW - origin.x, y: anchor.y * fullH - origin.y }
    if (dir.x === 0 && dir.y === 0) return { x: p.x + origin.x, y: p.y + origin.y }
    const hit = rayIntersectPolygon(origin, dir, poly)
    return { x: p.x + hit.x, y: p.y + hit.y }
  }

  const w = fullW / 2
  const h = fullH / 2
  const cx = p.x + w
  const cy = p.y + h
  // Dirección centro→anclaje en coordenadas de caja.
  const dx = anchor.x * fullW - w
  const dy = anchor.y * fullH - h
  if (dx === 0 && dy === 0) return { x: cx, y: cy }

  if (isDiamond(node)) {
    const denom = Math.abs(dx) / w + Math.abs(dy) / h
    const t = denom > 0 ? 1 / denom : 0
    return { x: cx + dx * t, y: cy + dy * t }
  }

  const r = cornerRadius(node, fullW, fullH)
  const off = intersectRoundedRect(w, h, r, dx, dy)
  return { x: cx + off.x, y: cy + off.y }
}

export function getFloatingAnchor(node: Node, otherNode: Node): AnchorResult {
  const np = absPos(node)
  const fullW = node.measured?.width ?? node.width ?? 100
  const fullH = node.measured?.height ?? node.height ?? 40
  // Centros de referencia (icono para archIcon, centro de caja para el resto).
  const { x: nx, y: ny } = rayCenter(node)
  const { x: ox, y: oy } = rayCenter(otherNode)

  const dx = ox - nx
  const dy = oy - ny

  // archIcon: rayo centro-icono → centro-otro, intersecado con la silueta botella.
  if (isArchBottle(node)) {
    const position = sideFromDir(dx, dy)
    if (dx === 0 && dy === 0) return { x: nx, y: ny, position }
    const poly = archBottlePolygonForNode(node)
    const origin = archIconCenterLocal()
    const hit = rayIntersectPolygon(origin, { x: dx, y: dy }, poly)
    return { x: np.x + hit.x, y: np.y + hit.y, position }
  }

  const w = fullW / 2
  const h = fullH / 2

  const absDx = Math.abs(dx)
  const absDy = Math.abs(dy)

  // Posición dominante (lado por el que sale/entra la arista): común a caja, rombo
  // y formas redondeadas; orienta la flecha y el routing ortogonal.
  const position =
    absDx / w > absDy / h
      ? dx > 0 ? Position.Right : Position.Left
      : dy > 0 ? Position.Bottom : Position.Top

  // Centros superpuestos: sin dirección útil, devolvemos el centro.
  if (absDx === 0 && absDy === 0) return { x: nx, y: ny, position }

  // Rombo: punto donde el rayo centro→centro corta el perímetro |X|/w + |Y|/h = 1.
  // El extremo aterriza sobre el lado real del rombo, apuntando al otro nodo.
  if (isDiamond(node)) {
    const denom = absDx / w + absDy / h
    const t = denom > 0 ? 1 / denom : 0
    return { x: nx + dx * t, y: ny + dy * t, position }
  }

  // Resto de formas: intersección con el rectángulo redondeado según su radio de
  // esquina, así el extremo se pega al borde curvo real (cápsula, círculo…) y no
  // a las esquinas vacías de la caja envolvente.
  const r = cornerRadius(node, fullW, fullH)
  const off = intersectRoundedRect(w, h, r, dx, dy)
  return { x: nx + off.x, y: ny + off.y, position }
}
