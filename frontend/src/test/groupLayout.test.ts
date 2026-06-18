import { describe, test, expect } from 'vitest'
import { architectureLayoutSync } from '../ui/utils/architectureLayout'
import type { DiagramSchema } from '../types'

// Diagrama de arquitectura con un grupo "Backend" (un nodo) y geometría manual
// guardada para su contenedor.
function archDiagram(group_layout?: DiagramSchema['group_layout']): DiagramSchema {
  return {
    title: 'Sistema',
    diagram_type: 'architecture',
    nodes: [
      { id: 'api', label: 'API', node_type: 'service', attributes: ['group: Backend'] },
    ],
    edges: [],
    group_layout,
  }
}

describe('architectureLayoutSync — override manual de grupos (group_layout)', () => {
  test('sin override usa la geometría calculada (la del contenedor NO es la del usuario)', () => {
    const { nodes } = architectureLayoutSync(archDiagram())
    const container = nodes.find((n) => n.id === 'group__Backend')!
    expect(container).toBeTruthy()
    expect(container.position).not.toEqual({ x: 999, y: 888 })
  })

  test('con override, el contenedor toma posición y tamaño guardados', () => {
    const { nodes } = architectureLayoutSync(
      archDiagram({ group__Backend: { x: 999, y: 888, width: 444, height: 333 } }),
    )
    const container = nodes.find((n) => n.id === 'group__Backend')!
    expect(container.position).toEqual({ x: 999, y: 888 })
    expect(container.style).toMatchObject({ width: 444, height: 333 })
  })
})
