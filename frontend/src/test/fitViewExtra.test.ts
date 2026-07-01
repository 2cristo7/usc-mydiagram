import { describe, it, expect } from 'vitest'
import {
  FIT_VIEW_OPTIONS,
  FIT_VIEW_DURATION,
  topAnchoredViewport,
} from '../ui/utils/fitView'
import type { Rect } from '@xyflow/react'

// Constantes internas del encuadre con anclaje superior (no exportadas).
const SEQ_PAD_X = 32
const SEQ_PAD_TOP = 40
const SEQ_PAD_BOTTOM = 150
const SEQ_MIN_ZOOM = 0.5
const SEQ_MAX_ZOOM = 1.0

describe('FIT_VIEW_OPTIONS / FIT_VIEW_DURATION', () => {
  it('topa el zoom de encuadre en 1.0 (misma escala entre diagramas)', () => {
    expect(FIT_VIEW_OPTIONS.maxZoom).toBe(1.0)
  })
  it('reserva margen inferior amplio para el prompt flotante', () => {
    expect(FIT_VIEW_OPTIONS.padding).toEqual({
      top: '32px',
      right: '32px',
      left: '32px',
      bottom: '150px',
    })
  })
  it('la duración de la animación imperativa es 400 ms', () => {
    expect(FIT_VIEW_DURATION).toBe(400)
  })
})

describe('topAnchoredViewport — selección de zoom', () => {
  const pane = { w: 1200, h: 900 }

  it('cuando el ANCHO es la restricción, el zoom = (pane-2·padX)/width', () => {
    // width grande, height pequeño: el ancho limita.
    const bounds: Rect = { x: 0, y: 0, width: 2272, height: 100 }
    const vp = topAnchoredViewport(bounds, pane.w, pane.h)
    const expectedZoomX = (pane.w - 2 * SEQ_PAD_X) / bounds.width // 1136/2272 = 0.5
    expect(vp.zoom).toBeCloseTo(expectedZoomX)
  })

  it('cuando el ALTO es la restricción, el zoom = (pane-padTop-padBottom)/height', () => {
    const bounds: Rect = { x: 0, y: 0, width: 100, height: 1420 }
    const vp = topAnchoredViewport(bounds, pane.w, pane.h)
    const expectedZoomY = (pane.h - SEQ_PAD_TOP - SEQ_PAD_BOTTOM) / bounds.height // 710/1420 = 0.5
    expect(vp.zoom).toBeCloseTo(expectedZoomY)
  })

  it('nunca por debajo de SEQ_MIN_ZOOM aunque cupiera a menos', () => {
    const bounds: Rect = { x: 0, y: 0, width: 100000, height: 100000 }
    const vp = topAnchoredViewport(bounds, pane.w, pane.h)
    expect(vp.zoom).toBe(SEQ_MIN_ZOOM)
  })

  it('nunca por encima de SEQ_MAX_ZOOM aunque cupiera a más', () => {
    const bounds: Rect = { x: 0, y: 0, width: 10, height: 10 }
    const vp = topAnchoredViewport(bounds, pane.w, pane.h)
    expect(vp.zoom).toBe(SEQ_MAX_ZOOM)
  })

  it('el borde superior queda anclado a SEQ_PAD_TOP tras aplicar el viewport', () => {
    const bounds: Rect = { x: 10, y: 35, width: 400, height: 300 }
    const vp = topAnchoredViewport(bounds, pane.w, pane.h)
    // y_pantalla del borde superior = vp.y + bounds.y * zoom
    expect(vp.y + bounds.y * vp.zoom).toBeCloseTo(SEQ_PAD_TOP)
  })
})
