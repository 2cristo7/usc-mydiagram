import { describe, test, expect } from 'vitest'
import { orderByTree } from '../components/ChatPanel'
import type { VersionMeta } from '../types'

// Construye una versión mínima; parent encadena el árbol.
function v(id: string, seq: number, parent: string | null): VersionMeta {
  return { id, seq, origin: 'refine', instruction: id, op_summary: null, parent_version_id: parent, created_at: '' }
}

const ids = (vs: VersionMeta[]) => vs.map((x) => x.id)

describe('orderByTree — linealización del árbol de versiones', () => {
  test('lista vacía → vacío', () => {
    expect(orderByTree([], null)).toEqual([])
  })

  test('cadena lineal: orden raíz→actual, sin ramas muertas', () => {
    const vs = [v('a', 1, null), v('b', 2, 'a'), v('c', 3, 'b')]
    expect(ids(orderByTree(vs, 'c'))).toEqual(['a', 'b', 'c'])
  })

  test('ramificación: rama muerta arriba, camino vivo abajo (caso 1→2, vuelvo a 1, hago 3)', () => {
    // a=1 raíz; b=2 hijo de a (rama que se abandonará); c=3 hijo de a (nuevo camino).
    const vs = [v('a', 1, null), v('b', 2, 'a'), v('c', 3, 'a')]
    // Posición actual = c (el nuevo): camino vivo a→c; b queda muerta arriba.
    expect(ids(orderByTree(vs, 'c'))).toEqual(['b', 'a', 'c'])
  })

  test('rama profunda muerta entera por encima del camino vivo', () => {
    // a→b→d (rama vieja) ; a→c (camino vivo actual)
    const vs = [v('a', 1, null), v('b', 2, 'a'), v('c', 3, 'a'), v('d', 4, 'b')]
    expect(ids(orderByTree(vs, 'c'))).toEqual(['b', 'd', 'a', 'c'])
  })

  test('sin posición actual (null) → todo son ramas muertas, por seq', () => {
    const vs = [v('a', 1, null), v('c', 3, 'a'), v('b', 2, 'a')]
    expect(ids(orderByTree(vs, null))).toEqual(['a', 'b', 'c'])
  })
})
