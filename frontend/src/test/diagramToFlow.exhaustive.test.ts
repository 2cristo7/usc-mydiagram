/**
 * Tests exhaustivos del pipeline DiagramSchema → React Flow para los 7 tipos de
 * diagrama. Cubre:
 *  - Mapeo node_type → RF type para TODOS los node_types de cada tipo
 *  - Edge handling: source/target preservados, label preservado, tipo de edge
 *  - Posiciones numéricas válidas (no NaN, no undefined) para todos los tipos
 *  - Casos multi-nodo/multi-arista
 *  - Integridad: aristas huérfanas rechazadas vía diagramImportSchema para todos los tipos
 *
 * Los tests de sequence se delegan a sequenceLayout.test.ts; aquí solo verificamos
 * el dispatch.
 */
import { describe, test, expect, vi } from 'vitest'
import type { DiagramSchema, DiagramType, NodeType, EdgeType } from '../types'
// Alias sin prefijo `use` para no disparar el falso positivo de react-hooks al
// llamarlo dentro de un bucle (no es un hook; es el helper de tamaño del nodo).
import { DiagramToFlow, useCaseNodeSize as ucNodeSize } from '../ui/utils/diagramToFlow'
import { diagramImportSchema } from '../types'

// Stub sequenceLayout para evitar efectos secundarios en tests no-sequence
vi.mock('../ui/utils/sequenceLayout', () => ({
  sequenceLayout: vi.fn(() => ({ nodes: [], edges: [] })),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(id: string, label: string, node_type: NodeType) {
  return { id, label, node_type, attributes: [] }
}

function makeEdge(id: string, source: string, target: string, label: string, edge_type: EdgeType) {
  return { id, source, target, label, edge_type }
}

function validPositions(nodes: { position: { x: number; y: number } }[]) {
  return nodes.every(
    (n) =>
      typeof n.position.x === 'number' &&
      !isNaN(n.position.x) &&
      typeof n.position.y === 'number' &&
      !isNaN(n.position.y),
  )
}

// ---------------------------------------------------------------------------
// ERD — node_types: table | edge_types: one_to_one, one_to_many, many_to_many
// ---------------------------------------------------------------------------
describe('ERD', () => {
  const diagram: DiagramSchema = {
    title: 'Tienda',
    diagram_type: 'erd',
    nodes: [
      makeNode('usuario', 'Usuario', 'table'),
      makeNode('pedido', 'Pedido', 'table'),
      makeNode('producto', 'Producto', 'table'),
    ],
    edges: [
      makeEdge('e1', 'usuario', 'pedido', 'realiza', 'one_to_many'),
      makeEdge('e2', 'pedido', 'producto', 'contiene', 'many_to_many'),
      makeEdge('e3', 'usuario', 'producto', 'favorito', 'one_to_one'),
    ],
  }

  test('table → RF type "table"', () => {
    const { nodes } = DiagramToFlow(diagram)
    nodes.forEach((n) => expect(n.type).toBe('table'))
  })

  test('todos los nodos tienen position numérica válida', () => {
    const { nodes } = DiagramToFlow(diagram)
    expect(validPositions(nodes)).toBe(true)
  })

  test('se generan las 3 aristas con source/target/label correctos', () => {
    const { edges } = DiagramToFlow(diagram)
    expect(edges).toHaveLength(3)
    const e1 = edges.find((e) => e.id === 'e1')!
    expect(e1.source).toBe('usuario')
    expect(e1.target).toBe('pedido')
    expect(e1.data?.label).toBe('realiza')
    const e2 = edges.find((e) => e.id === 'e2')!
    expect(e2.source).toBe('pedido')
    expect(e2.target).toBe('producto')
    const e3 = edges.find((e) => e.id === 'e3')!
    expect(e3.source).toBe('usuario')
    expect(e3.target).toBe('producto')
  })

  test('arista huérfana rechazada por diagramImportSchema', () => {
    const roto = {
      ...diagram,
      edges: [makeEdge('ex', 'usuario', 'fantasma', 'x', 'one_to_many')],
    }
    expect(diagramImportSchema.safeParse(roto).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// USE_CASE — node_types: actor, use_case, system | edge_types: association, include, extend, inherits
// ---------------------------------------------------------------------------
describe('Use Case', () => {
  const diagram: DiagramSchema = {
    title: 'Tienda online',
    diagram_type: 'use_case',
    nodes: [
      makeNode('cliente', 'Cliente', 'actor'),
      makeNode('admin', 'Administrador', 'actor'),
      makeNode('sys', 'Tienda', 'system'),
      makeNode('uc1', 'Comprar producto', 'use_case'),
      makeNode('uc2', 'Autenticarse', 'use_case'),
      makeNode('uc3', 'Gestionar catálogo', 'use_case'),
    ],
    edges: [
      makeEdge('e1', 'cliente', 'uc1', '', 'association'),
      makeEdge('e2', 'admin', 'uc3', '', 'association'),
      makeEdge('e3', 'uc1', 'uc2', '', 'include'),
      makeEdge('e4', 'uc1', 'uc3', '', 'extend'),
      makeEdge('e5', 'cliente', 'admin', '', 'inherits'),
    ],
  }

  test('actor → RF type "useCaseActor" (override use_case)', () => {
    const { nodes } = DiagramToFlow(diagram)
    const actors = nodes.filter((n) => n.data.nodeType === 'actor')
    expect(actors).toHaveLength(2)
    actors.forEach((n) => expect(n.type).toBe('useCaseActor'))
  })

  test('use_case → RF type "useCase"', () => {
    const { nodes } = DiagramToFlow(diagram)
    const ucs = nodes.filter((n) => n.data.nodeType === 'use_case')
    expect(ucs).toHaveLength(3)
    ucs.forEach((n) => expect(n.type).toBe('useCase'))
  })

  test('system → RF type "useCaseSystem" (override use_case)', () => {
    const { nodes } = DiagramToFlow(diagram)
    const systems = nodes.filter((n) => n.data.nodeType === 'system')
    expect(systems).toHaveLength(1)
    systems.forEach((n) => expect(n.type).toBe('useCaseSystem'))
  })

  test('todos los nodos tienen position numérica válida', () => {
    const { nodes } = DiagramToFlow(diagram)
    expect(validPositions(nodes)).toBe(true)
  })

  test('se generan las 5 aristas con source/target preservados', () => {
    const { edges } = DiagramToFlow(diagram)
    expect(edges).toHaveLength(5)
    const e3 = edges.find((e) => e.id === 'e3')!
    expect(e3.source).toBe('uc1')
    expect(e3.target).toBe('uc2')
  })

  test('arista include lleva strokeStyle dashed por defecto', () => {
    const { edges } = DiagramToFlow(diagram)
    const include = edges.find((e) => e.id === 'e3')!
    expect((include.data as Record<string, unknown>)?.strokeStyle).toBe('dashed')
  })

  test('arista inherits lleva markerEndId "arrowHollow" por defecto', () => {
    const { edges } = DiagramToFlow(diagram)
    const inherits = edges.find((e) => e.id === 'e5')!
    expect((inherits.data as Record<string, unknown>)?.markerEndId).toBe('arrowHollow')
  })

  test('arista huérfana rechazada', () => {
    const roto = { ...diagram, edges: [makeEdge('ex', 'cliente', 'nulo', '', 'association')] }
    expect(diagramImportSchema.safeParse(roto).success).toBe(false)
  })

  // La caja «system» debe CONTENER todos los casos, sin recortarlos. Se prueba con
  // muchos casos (2 columnas) y una etiqueta larga que envuelve a varias líneas: su
  // rectángulo real (useCaseNodeSize) tiene que quedar dentro del box.
  test('el box system contiene el rectángulo de cada caso de uso', () => {
    const grande: DiagramSchema = {
      title: 'Plataforma',
      diagram_type: 'use_case',
      nodes: [
        makeNode('actor1', 'Usuario', 'actor'),
        makeNode('actor2', 'Administrador del sistema', 'actor'),
        makeNode('sys', 'Plataforma', 'system'),
        makeNode('c1', 'Registrar una incidencia con descripción muy detallada y adjuntos', 'use_case'),
        makeNode('c2', 'Login', 'use_case'),
        makeNode('c3', 'Consultar histórico de incidencias resueltas', 'use_case'),
        makeNode('c4', 'Exportar', 'use_case'),
        makeNode('c5', 'Asignar técnico responsable a una incidencia abierta', 'use_case'),
        makeNode('c6', 'Cerrar incidencia', 'use_case'),
        makeNode('c7', 'Notificar', 'use_case'),
        makeNode('c8', 'Gestionar permisos de los usuarios del sistema', 'use_case'),
      ],
      edges: [
        makeEdge('a1', 'actor1', 'c1', '', 'association'),
        makeEdge('a2', 'actor1', 'c2', '', 'association'),
        makeEdge('a3', 'actor2', 'c8', '', 'association'),
        makeEdge('a4', 'actor2', 'c5', '', 'association'),
      ],
    }
    const { nodes } = DiagramToFlow(grande)
    const sys = nodes.find((n) => n.type === 'useCaseSystem')!
    const sysW = (sys.style as { width: number }).width
    const sysH = (sys.style as { height: number }).height
    const boxL = sys.position.x, boxT = sys.position.y
    const boxR = boxL + sysW, boxB = boxT + sysH

    const cases = nodes.filter((n) => n.type === 'useCase')
    expect(cases.length).toBe(8)
    for (const c of cases) {
      const { width, height } = ucNodeSize((c.data as { label: string }).label)
      expect(c.position.x).toBeGreaterThanOrEqual(boxL)
      expect(c.position.y).toBeGreaterThanOrEqual(boxT)
      expect(c.position.x + width).toBeLessThanOrEqual(boxR)
      expect(c.position.y + height).toBeLessThanOrEqual(boxB)
    }
  })

  // Un override manual de la caja MÁS PEQUEÑO que el contenido no debe recortar: el
  // auto-size actúa como suelo y el box se expande para seguir cubriéndolo todo.
  test('override manual menor que el contenido se expande hasta contener los casos', () => {
    const conOverride: DiagramSchema = {
      title: 'Tienda online',
      diagram_type: 'use_case',
      nodes: diagram.nodes,
      edges: diagram.edges,
      group_layout: { sys: { x: 200, y: 50, width: 40, height: 40 } },
    }
    const { nodes } = DiagramToFlow(conOverride)
    const sys = nodes.find((n) => n.type === 'useCaseSystem')!
    const sysW = (sys.style as { width: number }).width
    const sysH = (sys.style as { height: number }).height
    const boxL = sys.position.x, boxT = sys.position.y
    const boxR = boxL + sysW, boxB = boxT + sysH

    for (const c of nodes.filter((n) => n.type === 'useCase')) {
      const { width, height } = ucNodeSize((c.data as { label: string }).label)
      expect(c.position.x).toBeGreaterThanOrEqual(boxL)
      expect(c.position.y).toBeGreaterThanOrEqual(boxT)
      expect(c.position.x + width).toBeLessThanOrEqual(boxR)
      expect(c.position.y + height).toBeLessThanOrEqual(boxB)
    }
  })
})

// ---------------------------------------------------------------------------
// SEQUENCE — dispatched to sequenceLayout (smoke only)
// ---------------------------------------------------------------------------
describe('Sequence (dispatch)', () => {
  test('diagram_type sequence se despacha a sequenceLayout', async () => {
    const { sequenceLayout } = await import('../ui/utils/sequenceLayout')
    const diagram: DiagramSchema = {
      title: 'Login',
      diagram_type: 'sequence',
      nodes: [
        makeNode('u', 'User', 'actor'),
        makeNode('s', 'Server', 'actor'),
      ],
      edges: [
        makeEdge('e1', 'u', 's', 'login()', 'sequence'),
        makeEdge('e2', 's', 'u', '200 OK', 'sequence'),
      ],
    }
    DiagramToFlow(diagram)
    expect(sequenceLayout).toHaveBeenCalledWith(diagram)
  })
})

// ---------------------------------------------------------------------------
// FLOWCHART — node_types: step, decision, terminator | edge_types: flow, conditional
// ---------------------------------------------------------------------------
describe('Flowchart', () => {
  const diagram: DiagramSchema = {
    title: 'Proceso de compra',
    diagram_type: 'flowchart',
    nodes: [
      makeNode('inicio', 'Inicio', 'terminator'),
      makeNode('validar', '¿Usuario válido?', 'decision'),
      makeNode('procesar', 'Procesar pago', 'step'),
      makeNode('fin', 'Fin', 'terminator'),
    ],
    edges: [
      makeEdge('e1', 'inicio', 'validar', '', 'flow'),
      makeEdge('e2', 'validar', 'procesar', 'Sí', 'conditional'),
      makeEdge('e3', 'validar', 'fin', 'No', 'conditional'),
      makeEdge('e4', 'procesar', 'fin', '', 'flow'),
    ],
  }

  test('terminator → RF type "flow"', () => {
    const { nodes } = DiagramToFlow(diagram)
    const terminators = nodes.filter((n) => n.data.nodeType === 'terminator')
    expect(terminators).toHaveLength(2)
    terminators.forEach((n) => expect(n.type).toBe('flow'))
  })

  test('decision → RF type "flow"', () => {
    const { nodes } = DiagramToFlow(diagram)
    const decisions = nodes.filter((n) => n.data.nodeType === 'decision')
    expect(decisions).toHaveLength(1)
    decisions.forEach((n) => expect(n.type).toBe('flow'))
  })

  test('step → RF type "flow"', () => {
    const { nodes } = DiagramToFlow(diagram)
    const steps = nodes.filter((n) => n.data.nodeType === 'step')
    expect(steps).toHaveLength(1)
    steps.forEach((n) => expect(n.type).toBe('flow'))
  })

  test('todos los nodos tienen position numérica válida', () => {
    const { nodes } = DiagramToFlow(diagram)
    expect(validPositions(nodes)).toBe(true)
  })

  test('se generan 4 aristas con source/target/label correctos', () => {
    const { edges } = DiagramToFlow(diagram)
    expect(edges).toHaveLength(4)
    expect(edges.find((e) => e.id === 'e2')!.data?.label).toBe('Sí')
    expect(edges.find((e) => e.id === 'e3')!.data?.label).toBe('No')
  })

  test('arista huérfana rechazada', () => {
    const roto = { ...diagram, edges: [makeEdge('ex', 'inicio', 'nulo', '', 'flow')] }
    expect(diagramImportSchema.safeParse(roto).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// ARCHITECTURE — node_types: service, database, queue, gateway, person, system,
//               container, component | edge_types: calls, depends_on
// ---------------------------------------------------------------------------
describe('Architecture', () => {
  const diagram: DiagramSchema = {
    title: 'Backend',
    diagram_type: 'architecture',
    nodes: [
      makeNode('gw', 'API Gateway', 'gateway'),
      makeNode('svc', 'Auth Service', 'service'),
      makeNode('db', 'PostgreSQL', 'database'),
      makeNode('q', 'RabbitMQ', 'queue'),
      makeNode('usr', 'Dev User', 'person'),
      makeNode('sys', 'External System', 'system'),
      makeNode('ctr', 'Docker Container', 'container'),
      makeNode('cmp', 'Auth Module', 'component'),
    ],
    edges: [
      makeEdge('e1', 'gw', 'svc', 'routes to', 'calls'),
      makeEdge('e2', 'svc', 'db', 'reads/writes', 'depends_on'),
      makeEdge('e3', 'svc', 'q', 'publishes', 'calls'),
    ],
  }

  test('gateway → RF type "archIcon"', () => {
    const { nodes } = DiagramToFlow(diagram)
    expect(nodes.find((n) => n.id === 'gw')!.type).toBe('archIcon')
  })

  test('service → RF type "archIcon"', () => {
    const { nodes } = DiagramToFlow(diagram)
    expect(nodes.find((n) => n.id === 'svc')!.type).toBe('archIcon')
  })

  test('database → RF type "archIcon"', () => {
    const { nodes } = DiagramToFlow(diagram)
    expect(nodes.find((n) => n.id === 'db')!.type).toBe('archIcon')
  })

  test('queue → RF type "archIcon"', () => {
    const { nodes } = DiagramToFlow(diagram)
    expect(nodes.find((n) => n.id === 'q')!.type).toBe('archIcon')
  })

  test('person → RF type "archIcon"', () => {
    const { nodes } = DiagramToFlow(diagram)
    expect(nodes.find((n) => n.id === 'usr')!.type).toBe('archIcon')
  })

  test('system → RF type "archIcon"', () => {
    const { nodes } = DiagramToFlow(diagram)
    expect(nodes.find((n) => n.id === 'sys')!.type).toBe('archIcon')
  })

  test('container → RF type "archIcon"', () => {
    const { nodes } = DiagramToFlow(diagram)
    expect(nodes.find((n) => n.id === 'ctr')!.type).toBe('archIcon')
  })

  test('component → RF type "archIcon"', () => {
    const { nodes } = DiagramToFlow(diagram)
    expect(nodes.find((n) => n.id === 'cmp')!.type).toBe('archIcon')
  })

  test('todos los nodos tienen position numérica válida', () => {
    const { nodes } = DiagramToFlow(diagram)
    expect(validPositions(nodes)).toBe(true)
  })

  test('se generan 3 aristas correctamente', () => {
    const { edges } = DiagramToFlow(diagram)
    expect(edges).toHaveLength(3)
    expect(edges.find((e) => e.id === 'e1')!.source).toBe('gw')
    expect(edges.find((e) => e.id === 'e1')!.target).toBe('svc')
  })

  test('arista huérfana rechazada', () => {
    const roto = { ...diagram, edges: [makeEdge('ex', 'gw', 'nulo', '', 'calls')] }
    expect(diagramImportSchema.safeParse(roto).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// (State Machine eliminado en S10.3: reemplazado por Use Case arriba)

// ---------------------------------------------------------------------------
// MINDMAP — node_types: topic | edge_types: association
// ---------------------------------------------------------------------------
describe('Mindmap', () => {
  const diagram: DiagramSchema = {
    title: 'Tecnologías Web',
    diagram_type: 'mindmap',
    nodes: [
      makeNode('root', 'Tecnologías Web', 'topic'),
      makeNode('frontend', 'Frontend', 'topic'),
      makeNode('backend', 'Backend', 'topic'),
      makeNode('react', 'React', 'topic'),
      makeNode('node', 'Node.js', 'topic'),
    ],
    edges: [
      makeEdge('e1', 'root', 'frontend', '', 'association'),
      makeEdge('e2', 'root', 'backend', '', 'association'),
      makeEdge('e3', 'frontend', 'react', '', 'association'),
      makeEdge('e4', 'backend', 'node', '', 'association'),
    ],
  }

  test('topic → RF type "mindmap"', () => {
    const { nodes } = DiagramToFlow(diagram)
    nodes.forEach((n) => expect(n.type).toBe('mindmap'))
  })

  test('todos los nodos tienen position numérica válida', () => {
    const { nodes } = DiagramToFlow(diagram)
    expect(validPositions(nodes)).toBe(true)
  })

  test('se generan las 4 aristas con source/target correctos', () => {
    const { edges } = DiagramToFlow(diagram)
    expect(edges).toHaveLength(4)
    expect(edges.find((e) => e.id === 'e3')!.source).toBe('frontend')
    expect(edges.find((e) => e.id === 'e3')!.target).toBe('react')
  })

  test('arista huérfana rechazada', () => {
    const roto = { ...diagram, edges: [makeEdge('ex', 'root', 'nulo', '', 'association')] }
    expect(diagramImportSchema.safeParse(roto).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// POSICIONES — verificación cruzada de no-NaN y no-superpuestos en (0,0)
// ---------------------------------------------------------------------------
describe('Posiciones dagre — cobertura transversal', () => {
  const tipos: Array<{ diagram_type: DiagramType; nodes: DiagramSchema['nodes']; edges: DiagramSchema['edges'] }> = [
    {
      diagram_type: 'erd',
      nodes: [makeNode('a', 'A', 'table'), makeNode('b', 'B', 'table'), makeNode('c', 'C', 'table')],
      edges: [makeEdge('e1', 'a', 'b', '', 'one_to_many'), makeEdge('e2', 'b', 'c', '', 'one_to_one')],
    },
    {
      diagram_type: 'use_case',
      nodes: [makeNode('a', 'Actor', 'actor'), makeNode('uc', 'Login', 'use_case'), makeNode('sys', 'Sistema', 'system')],
      edges: [makeEdge('e1', 'a', 'uc', '', 'association')],
    },
    {
      diagram_type: 'flowchart',
      nodes: [makeNode('s', 'Start', 'terminator'), makeNode('p', 'Process', 'step'), makeNode('e', 'End', 'terminator')],
      edges: [makeEdge('e1', 's', 'p', '', 'flow'), makeEdge('e2', 'p', 'e', '', 'flow')],
    },
    {
      diagram_type: 'architecture',
      nodes: [makeNode('gw', 'GW', 'gateway'), makeNode('svc', 'Svc', 'service'), makeNode('db', 'DB', 'database')],
      edges: [makeEdge('e1', 'gw', 'svc', '', 'calls'), makeEdge('e2', 'svc', 'db', '', 'depends_on')],
    },
    {
      diagram_type: 'mindmap',
      nodes: [makeNode('r', 'Root', 'topic'), makeNode('c1', 'Child1', 'topic'), makeNode('c2', 'Child2', 'topic')],
      edges: [makeEdge('e1', 'r', 'c1', '', 'association'), makeEdge('e2', 'r', 'c2', '', 'association')],
    },
  ]

  tipos.forEach(({ diagram_type, nodes, edges }) => {
    test(`${diagram_type}: todos los nodos tienen position x/y numérica y no-NaN`, () => {
      const diagram: DiagramSchema = { title: 'test', diagram_type, nodes, edges }
      const { nodes: rfNodes } = DiagramToFlow(diagram)
      expect(validPositions(rfNodes)).toBe(true)
    })

    test(`${diagram_type}: no todos los nodos quedan apilados en (0,0) con dagre`, () => {
      const diagram: DiagramSchema = { title: 'test', diagram_type, nodes, edges }
      const { nodes: rfNodes } = DiagramToFlow(diagram)
      // Al menos un nodo debe estar en una posición distinta de {0,0}
      // (dagre siempre asigna coordenadas no triviales cuando hay > 1 nodo)
      const allAtOrigin = rfNodes.every((n) => n.position.x === 0 && n.position.y === 0)
      expect(allAtOrigin).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// Cobertura de data.nodeType propagada a React Flow data
// ---------------------------------------------------------------------------
describe('data.nodeType propagado correctamente', () => {
  test('ERD: data.nodeType = "table"', () => {
    const d: DiagramSchema = { title: 't', diagram_type: 'erd', nodes: [makeNode('n', 'N', 'table')], edges: [] }
    expect(DiagramToFlow(d).nodes[0].data.nodeType).toBe('table')
  })

  test('Flowchart: data.nodeType distingue step / decision / terminator', () => {
    const d: DiagramSchema = {
      title: 't',
      diagram_type: 'flowchart',
      nodes: [makeNode('s', 'S', 'step'), makeNode('d', 'D', 'decision'), makeNode('t', 'T', 'terminator')],
      edges: [],
    }
    const { nodes } = DiagramToFlow(d)
    expect(nodes.find((n) => n.id === 's')!.data.nodeType).toBe('step')
    expect(nodes.find((n) => n.id === 'd')!.data.nodeType).toBe('decision')
    expect(nodes.find((n) => n.id === 't')!.data.nodeType).toBe('terminator')
  })

  test('Architecture: data.nodeType preserva los 4 subtipos de arquitectura', () => {
    const d: DiagramSchema = {
      title: 't',
      diagram_type: 'architecture',
      nodes: [
        makeNode('gw', 'GW', 'gateway'),
        makeNode('svc', 'Svc', 'service'),
        makeNode('db', 'DB', 'database'),
        makeNode('q', 'Q', 'queue'),
      ],
      edges: [],
    }
    const { nodes } = DiagramToFlow(d)
    expect(nodes.find((n) => n.id === 'gw')!.data.nodeType).toBe('gateway')
    expect(nodes.find((n) => n.id === 'svc')!.data.nodeType).toBe('service')
    expect(nodes.find((n) => n.id === 'db')!.data.nodeType).toBe('database')
    expect(nodes.find((n) => n.id === 'q')!.data.nodeType).toBe('queue')
  })
})
