import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { createElement, type ReactElement } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { useStore } from '../store'
import {
  C4Node,
  ArchitectureNode,
  MindmapNode,
  FlowNode,
  UseCaseActorNode,
  SequenceActorNode,
} from '../components/nodes'
import { ArchIconNode } from '../components/nodes/ArchIconNode'
import { ArchitectureGroupNode } from '../components/nodes/ArchitectureGroupNode'
import { GroupResizeControls } from '../components/nodes/GroupResizeControls'

// El store de zustand es real: mockeamos solo la pasarela HTTP para que ningún
// updateNode dispare un fetch durante los tests de interacción.
vi.mock('../lib/api', () => ({
  persistCurrentDiagram: vi.fn(() => Promise.resolve({ ok: true })),
}))

// jsdom no trae ResizeObserver y ArchIconNode lo usa para medir su caja de texto.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub

const baseProps = {
  type: 'xxx',
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
  isConnectable: true,
  selected: false,
  zIndex: 0,
  dragging: false,
}

function withProvider(element: ReactElement) {
  return createElement(ReactFlowProvider, null, element)
}

beforeEach(() => {
  // Estado limpio: sin nodo en edición y sin diagrama (ArchIconNode lee
  // currentDiagram para reanexar atributos ocultos).
  useStore.setState({ editingNodeId: null, currentDiagram: null, editRequestNodeId: null })
})

describe('C4Node', () => {
  it('renderiza tipo y label en vista', () => {
    render(
      withProvider(
        createElement(C4Node, {
          ...baseProps,
          id: 'c1',
          data: { label: 'Web App', nodeType: 'container', attributes: ['tech: React'] },
        } as never)
      )
    )
    expect(screen.getByText('Web App')).toBeInTheDocument()
    expect(screen.getByText('container')).toBeInTheDocument()
    // tech: extraído del atributo
    expect(screen.getByText('React')).toBeInTheDocument()
  })

  it('doble clic arranca la edición inline (InlineAttrFields) y permite editar el nombre', () => {
    const { container } = render(
      withProvider(
        createElement(C4Node, {
          ...baseProps,
          id: 'c2',
          data: { label: 'Auth', nodeType: 'component', attributes: [] },
        } as never)
      )
    )
    // El nodo es el primer div con el handler de doble clic.
    fireEvent.doubleClick(screen.getByText('Auth'))
    // Tras entrar en edición aparece el input de nombre con autofocus.
    const nameInput = container.querySelector('input') as HTMLInputElement
    expect(nameInput).toBeTruthy()
    expect(nameInput.value).toBe('Auth')
    fireEvent.change(nameInput, { target: { value: 'AuthSvc' } })
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('AuthSvc')
  })

  it('InlineAttrFields: el botón Añadir agrega una fila de atributo', () => {
    const { container } = render(
      withProvider(
        createElement(C4Node, {
          ...baseProps,
          id: 'c3',
          data: { label: 'Box', nodeType: 'system', attributes: [] },
        } as never)
      )
    )
    fireEvent.doubleClick(screen.getByText('Box'))
    // Inicialmente solo el input de nombre (0 filas de atributo).
    expect(container.querySelectorAll('input').length).toBe(1)
    fireEvent.click(screen.getByText('Añadir'))
    // Ahora hay nombre + 1 fila de atributo.
    expect(container.querySelectorAll('input').length).toBe(2)
  })
})

describe('ArchitectureNode', () => {
  it('renderiza variantes y muestra tech', () => {
    render(
      withProvider(
        createElement(ArchitectureNode, {
          ...baseProps,
          id: 'a1',
          data: { label: 'PostgreSQL', nodeType: 'database', attributes: ['tech: pg16'] },
        } as never)
      )
    )
    expect(screen.getByText('PostgreSQL')).toBeInTheDocument()
    expect(screen.getByText('database')).toBeInTheDocument()
    expect(screen.getByText('pg16')).toBeInTheDocument()
  })

  it('doble clic + Añadir + Eliminar fila de atributo', () => {
    const { container } = render(
      withProvider(
        createElement(ArchitectureNode, {
          ...baseProps,
          id: 'a2',
          data: { label: 'Queue', nodeType: 'queue', attributes: [] },
        } as never)
      )
    )
    fireEvent.doubleClick(screen.getByText('Queue'))
    fireEvent.click(screen.getByText('Añadir'))
    expect(container.querySelectorAll('input').length).toBe(2)
    // Botón de eliminar (Trash2) es el botón con title="Eliminar atributo".
    const del = container.querySelector('button[title="Eliminar atributo"]') as HTMLButtonElement
    fireEvent.click(del)
    expect(container.querySelectorAll('input').length).toBe(1)
  })
})

describe('ArchIconNode', () => {
  const iconTypes = ['database', 'service', 'queue', 'gateway', 'person', 'system', 'container', 'component']
  for (const t of iconTypes) {
    it(`renderiza el icono del tipo ${t}`, () => {
      render(
        withProvider(
          createElement(ArchIconNode, {
            ...baseProps,
            id: `icon-${t}`,
            data: { label: `Node ${t}`, nodeType: t, attributes: [] },
          } as never)
        )
      )
      expect(screen.getByText(`Node ${t}`)).toBeInTheDocument()
      // El typeLabel en mayúsculas se renderiza (text-transform CSS, texto crudo en minúsculas).
      expect(screen.getAllByText(t).length).toBeGreaterThan(0)
    })
  }

  it('tipo desconocido cae al rect por defecto sin crashear', () => {
    render(
      withProvider(
        createElement(ArchIconNode, {
          ...baseProps,
          id: 'icon-x',
          data: { label: 'Custom', nodeType: 'weird', attributes: [] },
        } as never)
      )
    )
    expect(screen.getByText('Custom')).toBeInTheDocument()
  })

  it('selected=true pinta la silueta de selección', () => {
    const { container } = render(
      withProvider(
        createElement(ArchIconNode, {
          ...baseProps,
          id: 'icon-sel',
          selected: true,
          data: { label: 'Sel', nodeType: 'service', attributes: [] },
        } as never)
      )
    )
    // Hay al menos un path (la silueta) cuando está seleccionado.
    expect(container.querySelectorAll('path').length).toBeGreaterThan(0)
  })

  it('doble clic arranca edición inline', () => {
    const { container } = render(
      withProvider(
        createElement(ArchIconNode, {
          ...baseProps,
          id: 'icon-ed',
          data: { label: 'EditMe', nodeType: 'service', attributes: [] },
        } as never)
      )
    )
    fireEvent.doubleClick(screen.getByText('EditMe'))
    const nameInput = container.querySelector('input') as HTMLInputElement
    expect(nameInput).toBeTruthy()
    expect(nameInput.value).toBe('EditMe')
  })
})

describe('MindmapNode', () => {
  it('renderiza role root', () => {
    render(
      withProvider(
        createElement(MindmapNode, {
          ...baseProps,
          id: 'm1',
          data: { label: 'Centro', attributes: [], role: 'root' },
        } as never)
      )
    )
    expect(screen.getByText('Centro')).toBeInTheDocument()
  })

  it('renderiza role branch con branchColor', () => {
    render(
      withProvider(
        createElement(MindmapNode, {
          ...baseProps,
          id: 'm2',
          data: { label: 'Rama', attributes: [], role: 'branch', branchColor: '#ff0000' },
        } as never)
      )
    )
    expect(screen.getByText('Rama')).toBeInTheDocument()
  })

  it('renderiza role leaf (default)', () => {
    render(
      withProvider(
        createElement(MindmapNode, {
          ...baseProps,
          id: 'm3',
          data: { label: 'Hoja', attributes: [] },
        } as never)
      )
    )
    expect(screen.getByText('Hoja')).toBeInTheDocument()
  })

  it('doble clic arranca la edición inline (textarea)', () => {
    const { container } = render(
      withProvider(
        createElement(MindmapNode, {
          ...baseProps,
          id: 'm4',
          data: { label: 'Editable', attributes: [], role: 'root' },
        } as never)
      )
    )
    fireEvent.doubleClick(screen.getByText('Editable'))
    const ta = container.querySelector('textarea') as HTMLTextAreaElement
    expect(ta).toBeTruthy()
    expect(ta.value).toBe('Editable')
  })
})

describe('FlowNode', () => {
  it('renderiza step (default)', () => {
    render(
      withProvider(
        createElement(FlowNode, {
          ...baseProps,
          id: 'f1',
          data: { label: 'Procesar', nodeType: 'step' },
        } as never)
      )
    )
    expect(screen.getByText('Procesar')).toBeInTheDocument()
  })

  it('renderiza decision (rombo) con texto en líneas', () => {
    render(
      withProvider(
        createElement(FlowNode, {
          ...baseProps,
          id: 'f2',
          selected: true,
          data: { label: 'Valido', nodeType: 'decision' },
        } as never)
      )
    )
    // decisionNodeSize parte el label en líneas; el texto sigue presente.
    expect(screen.getByText('Valido')).toBeInTheDocument()
  })

  it('renderiza terminator', () => {
    render(
      withProvider(
        createElement(FlowNode, {
          ...baseProps,
          id: 'f3',
          data: { label: 'Inicio', nodeType: 'terminator' },
        } as never)
      )
    )
    expect(screen.getByText('Inicio')).toBeInTheDocument()
  })

  it('doble clic en step arranca edición', () => {
    const { container } = render(
      withProvider(
        createElement(FlowNode, {
          ...baseProps,
          id: 'f4',
          data: { label: 'Edit', nodeType: 'step' },
        } as never)
      )
    )
    fireEvent.doubleClick(screen.getByText('Edit'))
    expect(container.querySelector('textarea')).toBeTruthy()
  })
})

describe('UseCaseActorNode', () => {
  it('renderiza label y doble clic edita', () => {
    const { container } = render(
      withProvider(
        createElement(UseCaseActorNode, {
          ...baseProps,
          id: 'uc1',
          data: { label: 'Cliente' },
        } as never)
      )
    )
    expect(screen.getByText('Cliente')).toBeInTheDocument()
    fireEvent.doubleClick(screen.getByText('Cliente'))
    expect(container.querySelector('textarea')).toBeTruthy()
  })
})

describe('SequenceActorNode', () => {
  it('renderiza label y doble clic edita', () => {
    const { container } = render(
      withProvider(
        createElement(SequenceActorNode, {
          ...baseProps,
          id: 'sa1',
          data: { label: 'Servidor' },
        } as never)
      )
    )
    expect(screen.getByText('Servidor')).toBeInTheDocument()
    fireEvent.doubleClick(screen.getByText('Servidor'))
    expect(container.querySelector('textarea')).toBeTruthy()
  })
})

describe('ArchitectureGroupNode + GroupResizeControls', () => {
  it('renderiza el contenedor con su etiqueta (no seleccionado)', () => {
    render(
      withProvider(
        createElement(ArchitectureGroupNode, {
          ...baseProps,
          id: 'g1',
          data: { label: 'backend' },
        } as never)
      )
    )
    expect(screen.getByText('backend')).toBeInTheDocument()
  })

  it('seleccionado muestra el NodeResizer (controles visibles)', () => {
    const { container } = render(
      withProvider(
        createElement(ArchitectureGroupNode, {
          ...baseProps,
          id: 'g2',
          selected: true,
          data: { label: 'frontend' },
        } as never)
      )
    )
    expect(screen.getByText('frontend')).toBeInTheDocument()
    // El NodeResizer pinta tiradores con la clase de react flow cuando es visible.
    expect(container.querySelector('.react-flow__resize-control')).toBeTruthy()
  })

  it('GroupResizeControls en aislamiento renderiza las 4 franjas de perímetro', () => {
    const { container } = render(
      withProvider(
        createElement(GroupResizeControls, {
          id: 'g3',
          selected: false,
          minWidth: 100,
          minHeight: 100,
        } as never)
      )
    )
    // Las 4 franjas (divs con cursor pointer) están presentes aunque no seleccionado.
    const divs = within(container).queryAllByText('', { selector: 'div' })
    expect(divs.length).toBeGreaterThanOrEqual(4)
  })
})
