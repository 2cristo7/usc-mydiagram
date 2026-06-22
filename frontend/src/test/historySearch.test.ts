import { describe, it, expect } from 'vitest'
import { filterHistory } from '../ui/utils/historyFilter'

const items = [
  { title: 'Usuarios y pedidos', diagram_type: 'erd' },
  { title: 'Login', diagram_type: 'flowchart' },
  { title: 'Reserva de cita', diagram_type: 'sequence' },
  { title: 'Backend services', diagram_type: 'architecture' },
]

describe('filterHistory — por título', () => {
  it('consulta vacía devuelve todo', () => {
    expect(filterHistory(items, '')).toHaveLength(4)
  })

  it('solo espacios devuelve todo', () => {
    expect(filterHistory(items, '   ')).toHaveLength(4)
  })

  it('match por subcadena del título, sin distinguir mayúsculas', () => {
    expect(filterHistory(items, 'LOGIN')).toEqual([
      { title: 'Login', diagram_type: 'flowchart' },
    ])
  })

  it('match insensible a acentos', () => {
    // "cita" en un título sin acento se encuentra escribiendo con acento y viceversa.
    expect(filterHistory(items, 'résèrva')).toEqual([
      { title: 'Reserva de cita', diagram_type: 'sequence' },
    ])
  })

  it('sin coincidencias devuelve vacío', () => {
    expect(filterHistory(items, 'zzz')).toEqual([])
  })
})

describe('filterHistory — por tipo de diagrama (acepciones)', () => {
  it('valor canónico del tipo: "erd"', () => {
    expect(filterHistory(items, 'erd')).toEqual([
      { title: 'Usuarios y pedidos', diagram_type: 'erd' },
    ])
  })

  it('etiqueta en español: "entidad-relación"', () => {
    expect(filterHistory(items, 'entidad-relación')).toHaveLength(1)
    expect(filterHistory(items, 'entidad-relación')[0].diagram_type).toBe('erd')
  })

  it('sinónimo: "base de datos" → erd', () => {
    expect(filterHistory(items, 'base de datos')[0].diagram_type).toBe('erd')
  })

  it('sinónimo: "tablas" → erd', () => {
    expect(filterHistory(items, 'tablas')[0].diagram_type).toBe('erd')
  })

  it('sinónimo parcial: "flujo" → flowchart', () => {
    expect(filterHistory(items, 'flujo')[0].diagram_type).toBe('flowchart')
  })

  it('sinónimo: "componentes" → architecture', () => {
    expect(filterHistory(items, 'componentes')[0].diagram_type).toBe('architecture')
  })

  it('combina título y tipo: nada casa', () => {
    expect(filterHistory(items, 'mindmap')).toEqual([])
  })
})
