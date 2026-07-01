import { beforeEach, describe, expect, it } from 'vitest'
import { useArchGeom, getArchTextSize } from '../store/archGeom'

beforeEach(() => {
  useArchGeom.setState({ sizes: new Map(), version: 0 })
})

describe('archGeom store', () => {
  it('setSize registra el tamaño e incrementa version', () => {
    useArchGeom.getState().setSize('n1', 80, 40)
    expect(useArchGeom.getState().sizes.get('n1')).toEqual({ w: 80, h: 40 })
    expect(useArchGeom.getState().version).toBe(1)
  })

  it('setSize con el MISMO tamaño es no-op (no incrementa version)', () => {
    useArchGeom.getState().setSize('n1', 80, 40)
    const v = useArchGeom.getState().version
    useArchGeom.getState().setSize('n1', 80, 40)
    expect(useArchGeom.getState().version).toBe(v)
  })

  it('setSize con tamaño distinto sí actualiza e incrementa version', () => {
    useArchGeom.getState().setSize('n1', 80, 40)
    useArchGeom.getState().setSize('n1', 80, 41)
    expect(useArchGeom.getState().sizes.get('n1')).toEqual({ w: 80, h: 41 })
    expect(useArchGeom.getState().version).toBe(2)
  })

  it('setSize crea un Map nuevo (inmutabilidad de la referencia)', () => {
    const before = useArchGeom.getState().sizes
    useArchGeom.getState().setSize('n1', 10, 10)
    expect(useArchGeom.getState().sizes).not.toBe(before)
  })

  it('removeSize borra una entrada existente e incrementa version', () => {
    useArchGeom.getState().setSize('n1', 80, 40)
    const v = useArchGeom.getState().version
    useArchGeom.getState().removeSize('n1')
    expect(useArchGeom.getState().sizes.has('n1')).toBe(false)
    expect(useArchGeom.getState().version).toBe(v + 1)
  })

  it('removeSize de un id inexistente es no-op (no incrementa version)', () => {
    useArchGeom.getState().setSize('n1', 80, 40)
    const v = useArchGeom.getState().version
    useArchGeom.getState().removeSize('otro')
    expect(useArchGeom.getState().version).toBe(v)
  })

  it('getArchTextSize devuelve el tamaño medido', () => {
    useArchGeom.getState().setSize('medido', 120, 60)
    expect(getArchTextSize('medido')).toEqual({ w: 120, h: 60 })
  })

  it('getArchTextSize devuelve {0,0} si el nodo no está medido', () => {
    expect(getArchTextSize('desconocido')).toEqual({ w: 0, h: 0 })
  })
})
