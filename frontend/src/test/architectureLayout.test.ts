import { describe, test, expect, vi } from 'vitest'

// sequenceLayout se mockea para evitar efectos secundarios en tests de DiagramToFlow
vi.mock('../ui/utils/sequenceLayout', () => ({
  sequenceLayout: vi.fn(() => ({ nodes: [], edges: [] })),
}))
import type { DiagramSchema, DiagramType, NodeType, EdgeType } from '../types'
import { parseGroups, architectureLayoutSync } from '../ui/utils/architectureLayout'
import { DiagramToFlow } from '../ui/utils/diagramToFlow'

// ── Helpers ──────────────────────────────────────────────────────────────────

function mkNode(id: string, label: string, nodeType: NodeType, attrs: string[] = []) {
  return { id, label, node_type: nodeType, attributes: attrs }
}

function mkEdge(id: string, source: string, target: string, label: string, edgeType: EdgeType) {
  return { id, source, target, label, edge_type: edgeType }
}

const DIAGRAM_3G: DiagramSchema = {
  title: 'Sistema de pedidos',
  diagram_type: 'architecture' as DiagramType,
  nodes: [
    mkNode('gw', 'API Gateway', 'gateway', ['group: Borde']),
    mkNode('auth', 'Auth Service', 'service', ['group: Backend', 'tech: Node.js']),
    mkNode('pagos', 'Servicio de Pagos', 'service', ['group: Backend', 'tech: Java']),
    mkNode('bd', 'BD de Usuarios', 'database', ['group: Datos', 'tech: PostgreSQL']),
    mkNode('cache', 'Caché', 'database', ['group: Datos', 'tech: Redis']),
    mkNode('cola', 'Bus de Eventos', 'queue', ['group: Datos', 'tech: Kafka']),
    mkNode('user', 'Usuario', 'person', []),
  ],
  edges: [
    mkEdge('e1', 'gw', 'auth', 'REST', 'calls'),
    mkEdge('e2', 'gw', 'pagos', 'REST', 'calls'),
    mkEdge('e3', 'auth', 'bd', 'lee/escribe', 'calls'),
    mkEdge('e4', 'pagos', 'cola', 'publica', 'calls'),
    mkEdge('e5', 'auth', 'cache', 'sesiones', 'depends_on'),
  ],
}

// ── parseGroups ──────────────────────────────────────────────────────────────

describe('parseGroups', () => {
  test('clasifica nodos con group: en los grupos correctos', () => {
    const { groups } = parseGroups(DIAGRAM_3G)

    expect(groups.has('Borde')).toBe(true)
    expect(groups.get('Borde')).toContain('gw')

    expect(groups.has('Backend')).toBe(true)
    expect(groups.get('Backend')).toContain('auth')
    expect(groups.get('Backend')).toContain('pagos')

    expect(groups.has('Datos')).toBe(true)
    expect(groups.get('Datos')).toContain('bd')
    expect(groups.get('Datos')).toContain('cache')
    expect(groups.get('Datos')).toContain('cola')
  })

  test('nodos sin group: van a ungrouped', () => {
    const { ungrouped } = parseGroups(DIAGRAM_3G)
    expect(ungrouped).toContain('user')
  })

  test('sin ningún group: todos son ungrouped', () => {
    const d: DiagramSchema = {
      title: 't', diagram_type: 'architecture',
      nodes: [mkNode('a', 'A', 'service'), mkNode('b', 'B', 'database')],
      edges: [],
    }
    const { groups, ungrouped } = parseGroups(d)
    expect(groups.size).toBe(0)
    expect(ungrouped).toEqual(['a', 'b'])
  })

  test('tolera formatos variantes: "group:Backend" (sin espacio)', () => {
    const d: DiagramSchema = {
      title: 't', diagram_type: 'architecture',
      nodes: [mkNode('x', 'X', 'service', ['group:Backend'])],
      edges: [],
    }
    const { groups } = parseGroups(d)
    expect(groups.has('Backend')).toBe(true)
  })

  test('tolera espacio extra: "group:  Datos "', () => {
    const d: DiagramSchema = {
      title: 't', diagram_type: 'architecture',
      nodes: [mkNode('x', 'X', 'service', ['group:  Datos '])],
      edges: [],
    }
    const { groups } = parseGroups(d)
    expect(groups.has('Datos')).toBe(true)
  })

  test('preserva atributo tech: intacto en los atributos del nodo', () => {
    const { groups } = parseGroups(DIAGRAM_3G)
    // Los atributos originales no se modifican — parseGroups es puro
    const authNode = DIAGRAM_3G.nodes.find((n) => n.id === 'auth')!
    expect(authNode.attributes).toContain('tech: Node.js')
    expect(groups.get('Backend')).toContain('auth')
  })
})

// ── architectureLayoutSync ───────────────────────────────────────────────────

describe('architectureLayoutSync', () => {
  test('crea un nodo contenedor por grupo (type architectureGroup)', () => {
    const { nodes } = architectureLayoutSync(DIAGRAM_3G)
    const containers = nodes.filter((n) => n.type === 'architectureGroup')
    expect(containers.length).toBe(3) // Borde, Backend, Datos
  })

  test('los nodos con group: llevan parentId del contenedor correspondiente', () => {
    const { nodes } = architectureLayoutSync(DIAGRAM_3G)
    const authNode = nodes.find((n) => n.id === 'auth')!
    expect(authNode.parentId).toMatch(/group__Backend/)
    expect(authNode.extent).toBe('parent')
  })

  test('nodos sin group: están en el nivel raíz (sin parentId)', () => {
    const { nodes } = architectureLayoutSync(DIAGRAM_3G)
    const userNode = nodes.find((n) => n.id === 'user')!
    expect(userNode.parentId).toBeUndefined()
    expect(userNode.extent).toBeUndefined()
  })

  test('todos los nodos tienen position x/y numérica válida', () => {
    const { nodes } = architectureLayoutSync(DIAGRAM_3G)
    for (const n of nodes) {
      expect(typeof n.position.x).toBe('number')
      expect(isNaN(n.position.x)).toBe(false)
      expect(typeof n.position.y).toBe('number')
      expect(isNaN(n.position.y)).toBe(false)
    }
  })

  test('los data.attributes de los nodos NO contienen group:', () => {
    const { nodes } = architectureLayoutSync(DIAGRAM_3G)
    for (const n of nodes) {
      if (n.type === 'architectureGroup') continue
      const attrs = (n.data as { attributes?: string[] }).attributes ?? []
      expect(attrs.some((a: string) => /^group\s*:/i.test(a))).toBe(false)
    }
  })

  test('data.attributes preserva tech: de los nodos', () => {
    const { nodes } = architectureLayoutSync(DIAGRAM_3G)
    const authNode = nodes.find((n) => n.id === 'auth')!
    const attrs = (authNode.data as { attributes?: string[] }).attributes ?? []
    expect(attrs).toContain('tech: Node.js')
  })

  test('las aristas usan el edge unificado (type default) en forma elbow', () => {
    const { edges } = architectureLayoutSync(DIAGRAM_3G)
    edges.forEach((e) => {
      expect(e.type).toBe('default')
      expect((e.data as { shape?: string }).shape).toBe('elbow')
    })
  })

  test('las dependencias (no "calls") salen con trazo discontinuo', () => {
    const { edges } = architectureLayoutSync(DIAGRAM_3G)
    const e5 = edges.find((e) => e.id === 'e5')! // depends_on
    expect((e5.data as { strokeStyle?: string }).strokeStyle).toBe('dashed')
  })

  test('respeta node.position guardada del usuario para nodo hijo', () => {
    const savedPos = { x: 99, y: 77 }
    const d: DiagramSchema = {
      title: 't', diagram_type: 'architecture',
      nodes: [
        { ...mkNode('svc', 'Svc', 'service', ['group: G1']), position: savedPos },
      ],
      edges: [],
    }
    const { nodes } = architectureLayoutSync(d)
    const svcNode = nodes.find((n) => n.id === 'svc')!
    expect(svcNode.position).toEqual(savedPos)
  })

  test('sin grupos: nodos distribuidos en fila (no todos en 0,0)', () => {
    const d: DiagramSchema = {
      title: 't', diagram_type: 'architecture',
      nodes: [mkNode('a', 'A', 'service'), mkNode('b', 'B', 'database'), mkNode('c', 'C', 'queue')],
      edges: [],
    }
    const { nodes } = architectureLayoutSync(d)
    const allAtOrigin = nodes.every((n) => n.position.x === 0 && n.position.y === 0)
    expect(allAtOrigin).toBe(false)
  })

  test('gateway mapea a type "archIcon"', () => {
    const d: DiagramSchema = {
      title: 't', diagram_type: 'architecture',
      nodes: [mkNode('gw', 'GW', 'gateway')],
      edges: [],
    }
    const { nodes } = architectureLayoutSync(d)
    expect(nodes.find((n) => n.id === 'gw')!.type).toBe('archIcon')
  })

  test('person mapea a type "archIcon"', () => {
    const d: DiagramSchema = {
      title: 't', diagram_type: 'architecture',
      nodes: [mkNode('u', 'Usuario', 'person')],
      edges: [],
    }
    const { nodes } = architectureLayoutSync(d)
    expect(nodes.find((n) => n.id === 'u')!.type).toBe('archIcon')
  })
})

// ── Disposición con dagre (sigue las aristas) ─────────────────────────────────

describe('architectureLayoutSync — grupos siguen las aristas (dagre LR)', () => {
  // DIAGRAM_3G encadena Borde → Backend → Datos. Con dagre en dirección LR los
  // contenedores deben quedar en ese orden de izquierda a derecha (x creciente),
  // no repartidos en una rejilla ciega como hacía el layout anterior.
  test('los contenedores conectados se ordenan izquierda→derecha por el flujo', () => {
    const { nodes } = architectureLayoutSync(DIAGRAM_3G)
    const x = (id: string) => nodes.find((n) => n.id === id)!.position.x
    expect(x('group__Borde')).toBeLessThan(x('group__Backend'))
    expect(x('group__Backend')).toBeLessThan(x('group__Datos'))
  })

  test('los contenedores no se solapan entre sí', () => {
    const { nodes } = architectureLayoutSync(DIAGRAM_3G)
    const boxes = nodes
      .filter((n) => n.type === 'architectureGroup')
      .map((n) => {
        const s = n.style as { width: number; height: number }
        return { x: n.position.x, y: n.position.y, w: s.width, h: s.height }
      })
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j]
        const overlap =
          a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
        expect(overlap).toBe(false)
      }
    }
  })
})

// ── Rejilla de grupos (fallback sin aristas) ──────────────────────────────────

describe('architectureLayoutSync — grupos en rejilla', () => {
  // Diagrama con 4 grupos SIN aristas entre ellos: el caso que antes producía una
  // columna vertical y para el que dagre no tiene flujo que seguir. Se cae a la
  // rejilla (cols = ⌈√4⌉ = 2) y deben quedar en 2×2.
  const FOUR_GROUPS: DiagramSchema = {
    title: 'Cuatro grupos', diagram_type: 'architecture',
    nodes: [
      mkNode('a', 'A', 'service', ['group: Datos']),
      mkNode('b', 'B', 'person', ['group: Externos']),
      mkNode('c', 'C', 'container', ['group: Frontend']),
      mkNode('d', 'D', 'service', ['group: Backend']),
    ],
    edges: [],
  }

  test('sin aristas entre grupos, los contenedores se reparten en varias columnas y filas', () => {
    const { nodes } = architectureLayoutSync(FOUR_GROUPS)
    const containers = nodes.filter((n) => n.type === 'architectureGroup')
    expect(containers.length).toBe(4)
    const xs = new Set(containers.map((c) => Math.round(c.position.x)))
    const ys = new Set(containers.map((c) => Math.round(c.position.y)))
    // 4 grupos → rejilla 2×2: NO todos en la misma columna (el bug original) ni fila.
    expect(xs.size).toBeGreaterThan(1)
    expect(ys.size).toBeGreaterThan(1)
  })

  test('los contenedores de la rejilla no se solapan entre sí', () => {
    const { nodes } = architectureLayoutSync(FOUR_GROUPS)
    const boxes = nodes
      .filter((n) => n.type === 'architectureGroup')
      .map((n) => {
        const s = n.style as { width: number; height: number }
        return { x: n.position.x, y: n.position.y, w: s.width, h: s.height }
      })
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j]
        const overlap =
          a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
        expect(overlap).toBe(false)
      }
    }
  })
})

// ── DiagramToFlow bifurcación ─────────────────────────────────────────────────

describe('DiagramToFlow bifurca a architectureLayoutSync para architecture', () => {
  test('devuelve nodos de arquitectura con type correcto', () => {
    const d: DiagramSchema = {
      title: 't', diagram_type: 'architecture',
      nodes: [mkNode('gw', 'GW', 'gateway'), mkNode('svc', 'Svc', 'service')],
      edges: [mkEdge('e1', 'gw', 'svc', 'REST', 'calls')],
    }
    const { nodes, edges } = DiagramToFlow(d)
    expect(nodes.find((n) => n.id === 'gw')!.type).toBe('archIcon')
    expect(edges[0].type).toBe('default')
  })

  test('positions son válidas (no NaN)', () => {
    const d: DiagramSchema = {
      title: 't', diagram_type: 'architecture',
      nodes: [mkNode('a', 'A', 'service'), mkNode('b', 'B', 'database')],
      edges: [],
    }
    const { nodes } = DiagramToFlow(d)
    nodes.forEach((n) => {
      expect(isNaN(n.position.x)).toBe(false)
      expect(isNaN(n.position.y)).toBe(false)
    })
  })
})

// ── contenedores de grupo: geometría válida ───────────────────────────────────

describe('architectureLayoutSync — contenedores de grupo', () => {
  test('los contenedores de grupo tienen style con width y height', () => {
    const { nodes } = architectureLayoutSync(DIAGRAM_3G)
    const containers = nodes.filter((n) => n.type === 'architectureGroup')
    expect(containers.length).toBe(3)
    for (const c of containers) {
      const style = c.style as { width?: number; height?: number } | undefined
      expect(style?.width).toBeGreaterThan(0)
      expect(style?.height).toBeGreaterThan(0)
    }
  })

  test('grafo vacío devuelve layout sin nodos ni aristas (sin errores)', () => {
    const empty: DiagramSchema = {
      title: 'vacío', diagram_type: 'architecture', nodes: [], edges: [],
    }
    const result = architectureLayoutSync(empty)
    expect(result.nodes).toHaveLength(0)
    expect(result.edges).toHaveLength(0)
  })
})
