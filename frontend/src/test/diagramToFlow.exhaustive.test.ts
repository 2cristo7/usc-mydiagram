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
import { DiagramToFlow } from '../ui/utils/diagramToFlow'
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
    expect(e1.label).toBe('realiza')
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
// UML_CLASS — node_types: class | edge_types: inherits, implements, association, depends_on
// ---------------------------------------------------------------------------
describe('UML Class', () => {
  const diagram: DiagramSchema = {
    title: 'Clases',
    diagram_type: 'uml_class',
    nodes: [
      makeNode('animal', 'Animal', 'class'),
      makeNode('perro', 'Perro', 'class'),
      makeNode('corredor', 'ICorredor', 'class'),
    ],
    edges: [
      makeEdge('e1', 'perro', 'animal', 'extends', 'inherits'),
      makeEdge('e2', 'perro', 'corredor', 'implements', 'implements'),
      makeEdge('e3', 'animal', 'corredor', 'usa', 'association'),
      makeEdge('e4', 'perro', 'corredor', 'depende', 'depends_on'),
    ],
  }

  test('class → RF type "umlClass"', () => {
    const { nodes } = DiagramToFlow(diagram)
    nodes.forEach((n) => expect(n.type).toBe('umlClass'))
  })

  test('todos los nodos tienen position numérica válida', () => {
    const { nodes } = DiagramToFlow(diagram)
    expect(validPositions(nodes)).toBe(true)
  })

  test('se generan las 4 aristas con label preservado', () => {
    const { edges } = DiagramToFlow(diagram)
    expect(edges).toHaveLength(4)
    expect(edges.find((e) => e.id === 'e1')!.label).toBe('extends')
    expect(edges.find((e) => e.id === 'e2')!.label).toBe('implements')
    expect(edges.find((e) => e.id === 'e3')!.label).toBe('usa')
    expect(edges.find((e) => e.id === 'e4')!.label).toBe('depende')
  })

  test('arista huérfana rechazada', () => {
    const roto = { ...diagram, edges: [makeEdge('ex', 'perro', 'nulo', 'x', 'inherits')] }
    expect(diagramImportSchema.safeParse(roto).success).toBe(false)
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
    expect(edges.find((e) => e.id === 'e2')!.label).toBe('Sí')
    expect(edges.find((e) => e.id === 'e3')!.label).toBe('No')
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

  test('gateway → RF type "architecture"', () => {
    const { nodes } = DiagramToFlow(diagram)
    expect(nodes.find((n) => n.id === 'gw')!.type).toBe('architecture')
  })

  test('service → RF type "architecture"', () => {
    const { nodes } = DiagramToFlow(diagram)
    expect(nodes.find((n) => n.id === 'svc')!.type).toBe('architecture')
  })

  test('database → RF type "architecture"', () => {
    const { nodes } = DiagramToFlow(diagram)
    expect(nodes.find((n) => n.id === 'db')!.type).toBe('architecture')
  })

  test('queue → RF type "architecture"', () => {
    const { nodes } = DiagramToFlow(diagram)
    expect(nodes.find((n) => n.id === 'q')!.type).toBe('architecture')
  })

  test('person → RF type "c4" (arquitectura C4 mixta)', () => {
    const { nodes } = DiagramToFlow(diagram)
    expect(nodes.find((n) => n.id === 'usr')!.type).toBe('c4')
  })

  test('system → RF type "c4"', () => {
    const { nodes } = DiagramToFlow(diagram)
    expect(nodes.find((n) => n.id === 'sys')!.type).toBe('c4')
  })

  test('container → RF type "c4"', () => {
    const { nodes } = DiagramToFlow(diagram)
    expect(nodes.find((n) => n.id === 'ctr')!.type).toBe('c4')
  })

  test('component → RF type "c4"', () => {
    const { nodes } = DiagramToFlow(diagram)
    expect(nodes.find((n) => n.id === 'cmp')!.type).toBe('c4')
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
// STATE_MACHINE — node_types: state, terminator | edge_types: transition
// BUG CORREGIDO (S10): terminator en state_machine debe mapear a 'state', no 'flow'
// ---------------------------------------------------------------------------
describe('State Machine', () => {
  const diagram: DiagramSchema = {
    title: 'Semáforo',
    diagram_type: 'state_machine',
    nodes: [
      makeNode('init', '●', 'terminator'),   // nodo inicial (pseudo-estado)
      makeNode('rojo', 'Rojo', 'state'),
      makeNode('verde', 'Verde', 'state'),
      makeNode('amarillo', 'Amarillo', 'state'),
      makeNode('end', '◉', 'terminator'),    // nodo final (pseudo-estado)
    ],
    edges: [
      makeEdge('e1', 'init', 'rojo', 'start', 'transition'),
      makeEdge('e2', 'rojo', 'verde', '30s', 'transition'),
      makeEdge('e3', 'verde', 'amarillo', '25s', 'transition'),
      makeEdge('e4', 'amarillo', 'rojo', '5s', 'transition'),
      makeEdge('e5', 'verde', 'end', 'apagado', 'transition'),
    ],
  }

  test('state → RF type "state"', () => {
    const { nodes } = DiagramToFlow(diagram)
    const states = nodes.filter((n) => n.data.nodeType === 'state')
    expect(states).toHaveLength(3)
    states.forEach((n) => expect(n.type).toBe('state'))
  })

  test('terminator en state_machine → RF type "state" (no "flow")', () => {
    // BUG CORREGIDO: antes del fix, terminator mapeaba a 'flow' globalmente,
    // lo que hacía que se renderizara FlowNode en un diagrama de estados.
    const { nodes } = DiagramToFlow(diagram)
    const terminators = nodes.filter((n) => n.data.nodeType === 'terminator')
    expect(terminators).toHaveLength(2)
    terminators.forEach((n) => {
      expect(n.type).toBe('state')
      expect(n.type).not.toBe('flow')
    })
  })

  test('terminator en flowchart SÍ mapea a "flow" (no se rompe el override)', () => {
    const flowDiagram: DiagramSchema = {
      title: 'Flujo',
      diagram_type: 'flowchart',
      nodes: [makeNode('inicio', 'Inicio', 'terminator')],
      edges: [],
    }
    const { nodes } = DiagramToFlow(flowDiagram)
    expect(nodes[0].type).toBe('flow')
  })

  test('todos los nodos tienen position numérica válida', () => {
    const { nodes } = DiagramToFlow(diagram)
    expect(validPositions(nodes)).toBe(true)
  })

  test('se generan 5 transiciones con label preservado', () => {
    const { edges } = DiagramToFlow(diagram)
    expect(edges).toHaveLength(5)
    expect(edges.find((e) => e.id === 'e2')!.label).toBe('30s')
    expect(edges.find((e) => e.id === 'e3')!.label).toBe('25s')
    expect(edges.find((e) => e.id === 'e4')!.label).toBe('5s')
  })

  test('arista huérfana rechazada', () => {
    const roto = { ...diagram, edges: [makeEdge('ex', 'rojo', 'nulo', '', 'transition')] }
    expect(diagramImportSchema.safeParse(roto).success).toBe(false)
  })
})

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
      diagram_type: 'uml_class',
      nodes: [makeNode('x', 'X', 'class'), makeNode('y', 'Y', 'class')],
      edges: [makeEdge('e1', 'x', 'y', '', 'inherits')],
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
      diagram_type: 'state_machine',
      nodes: [makeNode('a', 'A', 'state'), makeNode('b', 'B', 'state'), makeNode('c', 'C', 'state')],
      edges: [makeEdge('e1', 'a', 'b', '', 'transition'), makeEdge('e2', 'b', 'c', '', 'transition')],
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
