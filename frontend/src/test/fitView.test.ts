import { describe, it, expect } from 'vitest'
import { topAnchoredViewport } from '../ui/utils/fitView'
import type { Rect } from '@xyflow/react'

// Constantes internas del encuadre (no exportadas) que el cálculo debe respetar.
const SEQ_PAD_TOP = 40
const SEQ_MAX_ZOOM = 1.0
const SEQ_MIN_ZOOM = 0.5

// Borde superior del contenido en coordenadas de PANTALLA tras aplicar el viewport.
const screenTop = (b: Rect, vp: { y: number; zoom: number }) => vp.y + b.y * vp.zoom
// Centro horizontal del contenido en pantalla.
const screenCenterX = (b: Rect, vp: { x: number; zoom: number }) =>
  vp.x + (b.x + b.width / 2) * vp.zoom

const pane = { w: 1200, h: 900 }

describe('topAnchoredViewport', () => {
  it('ancla el borde superior del contenido a SEQ_PAD_TOP', () => {
    const bounds: Rect = { x: 0, y: 0, width: 1000, height: 600 }
    const vp = topAnchoredViewport(bounds, pane.w, pane.h)
    expect(screenTop(bounds, vp)).toBeCloseTo(SEQ_PAD_TOP)
  })

  it('ancla arriba aunque el bounding box no empiece en y=0', () => {
    const bounds: Rect = { x: -50, y: 120, width: 800, height: 500 }
    const vp = topAnchoredViewport(bounds, pane.w, pane.h)
    expect(screenTop(bounds, vp)).toBeCloseTo(SEQ_PAD_TOP)
  })

  it('centra el contenido en horizontal', () => {
    const bounds: Rect = { x: 0, y: 0, width: 700, height: 500 }
    const vp = topAnchoredViewport(bounds, pane.w, pane.h)
    expect(screenCenterX(bounds, vp)).toBeCloseTo(pane.w / 2)
  })

  it('un diagrama MUY alto sigue con las cabeceras arriba (anclaje), aunque rebose por abajo', () => {
    // Alto enorme: el zoom topa en SEQ_MIN_ZOOM y el contenido no cabe en vertical.
    const bounds: Rect = { x: 0, y: 0, width: 600, height: 6000 }
    const vp = topAnchoredViewport(bounds, pane.w, pane.h)
    // El borde superior sigue anclado: las cabeceras se ven.
    expect(screenTop(bounds, vp)).toBeCloseTo(SEQ_PAD_TOP)
    // El borde inferior cae por DEBAJO del lienzo (rebosa) — preferimos eso a
    // recortar las cabeceras.
    expect(vp.y + bounds.height * vp.zoom).toBeGreaterThan(pane.h)
    expect(vp.zoom).toBeGreaterThanOrEqual(SEQ_MIN_ZOOM)
  })

  it('nunca amplía por encima de SEQ_MAX_ZOOM (misma escala entre diagramas)', () => {
    // Diagrama diminuto: cabría a zoom alto, pero topamos en 1.0.
    const bounds: Rect = { x: 0, y: 0, width: 100, height: 80 }
    const vp = topAnchoredViewport(bounds, pane.w, pane.h)
    expect(vp.zoom).toBeLessThanOrEqual(SEQ_MAX_ZOOM)
  })
})
