import { describe, it } from 'vitest'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import { ReactFlowProvider, Position } from '@xyflow/react'
import {
  TableNode,
  C4Node,
  ArchitectureNode,
  FlowNode,
  MindmapNode,
  SequenceActorNode,
  LifelineNode,
  ActivationNode,
  UseCaseNode,
  UseCaseActorNode,
  UseCaseSystemNode,
} from '../components/nodes'
import { SequenceMessageEdge } from '../components/edges'

const baseProps = {
  id: '1',
  type: 'xxx',
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
  isConnectable: true,
  selected: false,
  zIndex: 0,
  dragging: false,
}

function withProvider(element: React.ReactElement) {
  return createElement(ReactFlowProvider, null, element)
}

describe('Nodes smoke', () => {
  it('TableNode renders without crashing', () => {
    render(
      withProvider(
        createElement(TableNode, {
          ...baseProps,
          data: { label: 'Users', attributes: ['id INT PK', 'name VARCHAR'] },
        } as any)
      )
    )
  })

  it('UseCaseNode renders without crashing', () => {
    render(
      withProvider(
        createElement(UseCaseNode, {
          ...baseProps,
          data: { label: 'Iniciar sesión' },
        } as any)
      )
    )
  })

  it('MindmapNode renders without crashing', () => {
    render(
      withProvider(
        createElement(MindmapNode, {
          ...baseProps,
          data: { label: 'Root Topic' },
        } as any)
      )
    )
  })

  it('LifelineNode renders without crashing', () => {
    render(
      withProvider(
        createElement(LifelineNode, {
          ...baseProps,
          data: { label: 'User', height: 300 },
        } as any)
      )
    )
  })

  it('ActivationNode renders without crashing', () => {
    render(
      withProvider(
        createElement(ActivationNode, {
          ...baseProps,
          data: { label: '' },
        } as any)
      )
    )
  })

  it('SequenceMessageEdge renders without crashing', () => {
    render(
      withProvider(
        createElement(
          'svg',
          null,
          createElement(SequenceMessageEdge, {
            id: 'e1',
            source: '1',
            target: '2',
            sourceX: 0,
            sourceY: 0,
            targetX: 200,
            targetY: 0,
            sourcePosition: Position.Right,
            targetPosition: Position.Left,
            data: { label: 'request()' },
            markerEnd: '',
          } as any)
        )
      )
    )
  })

  // -------------------------------------------------------------------------
  // Smoke tests para nodos no cubiertos anteriormente
  // -------------------------------------------------------------------------

  it('UseCaseActorNode renders without crashing', () => {
    render(
      withProvider(
        createElement(UseCaseActorNode, {
          ...baseProps,
          data: { label: 'Cliente' },
        } as any)
      )
    )
  })

  it('UseCaseSystemNode renders without crashing', () => {
    render(
      withProvider(
        createElement(UseCaseSystemNode, {
          ...baseProps,
          data: { label: 'Sistema bancario' },
        } as any)
      )
    )
  })

  it('C4Node renders without crashing — person', () => {
    render(
      withProvider(
        createElement(C4Node, {
          ...baseProps,
          data: { label: 'Dev User', nodeType: 'person' },
        } as any)
      )
    )
  })

  it('C4Node renders without crashing — system', () => {
    render(
      withProvider(
        createElement(C4Node, {
          ...baseProps,
          data: { label: 'External System', nodeType: 'system' },
        } as any)
      )
    )
  })

  it('C4Node renders without crashing — container', () => {
    render(
      withProvider(
        createElement(C4Node, {
          ...baseProps,
          data: { label: 'Web App', nodeType: 'container' },
        } as any)
      )
    )
  })

  it('C4Node renders without crashing — component', () => {
    render(
      withProvider(
        createElement(C4Node, {
          ...baseProps,
          data: { label: 'Auth Module', nodeType: 'component' },
        } as any)
      )
    )
  })

  it('ArchitectureNode renders without crashing — service', () => {
    render(
      withProvider(
        createElement(ArchitectureNode, {
          ...baseProps,
          data: { label: 'Auth Service', nodeType: 'service' },
        } as any)
      )
    )
  })

  it('ArchitectureNode renders without crashing — database', () => {
    render(
      withProvider(
        createElement(ArchitectureNode, {
          ...baseProps,
          data: { label: 'PostgreSQL', nodeType: 'database' },
        } as any)
      )
    )
  })

  it('ArchitectureNode renders without crashing — queue', () => {
    render(
      withProvider(
        createElement(ArchitectureNode, {
          ...baseProps,
          data: { label: 'RabbitMQ', nodeType: 'queue' },
        } as any)
      )
    )
  })

  it('ArchitectureNode renders without crashing — gateway', () => {
    render(
      withProvider(
        createElement(ArchitectureNode, {
          ...baseProps,
          data: { label: 'API Gateway', nodeType: 'gateway' },
        } as any)
      )
    )
  })

  it('FlowNode renders without crashing — step (default path)', () => {
    render(
      withProvider(
        createElement(FlowNode, {
          ...baseProps,
          data: { label: 'Procesar pago', nodeType: 'step' },
        } as any)
      )
    )
  })

  it('FlowNode renders without crashing — decision (rombo)', () => {
    render(
      withProvider(
        createElement(FlowNode, {
          ...baseProps,
          data: { label: '¿Válido?', nodeType: 'decision' },
        } as any)
      )
    )
  })

  it('FlowNode renders without crashing — terminator (inicio/fin)', () => {
    render(
      withProvider(
        createElement(FlowNode, {
          ...baseProps,
          data: { label: 'Inicio', nodeType: 'terminator' },
        } as any)
      )
    )
  })

  it('SequenceActorNode renders without crashing', () => {
    render(
      withProvider(
        createElement(SequenceActorNode, {
          ...baseProps,
          data: { label: 'Client' },
        } as any)
      )
    )
  })
})
