import { describe, it } from 'vitest'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import { ReactFlowProvider, Position } from '@xyflow/react'
import {
  TableNode,
  StateNode,
  MindmapNode,
  LifelineNode,
  ActivationNode,
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

  it('StateNode renders without crashing', () => {
    render(
      withProvider(
        createElement(StateNode, {
          ...baseProps,
          data: { label: 'Idle' },
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
})
