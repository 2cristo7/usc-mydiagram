import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createElement } from 'react'
import { useStore } from '../store'
import { useUiStore } from '../store/ui'
import { ChatPanel } from '../components/ChatPanel'
import { ToolTray } from '../components/ToolTray'
import { NodeOpList } from '../components/NodeOpList'
import { TypeChoiceButtons } from '../components/TypeChoiceButtons'
import { DiagramThumb } from '../components/DiagramThumb'
import type { NodeOp, ToolTraceEntry, VersionMeta, PendingTypeChoice } from '../types'

// jsdom no implementa scrollIntoView (ChatPanel hace autoscroll al fondo).
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {}
}

// useHistoryNav (usado por ChatPanel vía restoreVersion) importa getVersion de la
// pasarela HTTP; lo mockeamos para no tocar la red.
vi.mock('../lib/api', () => ({
  persistCurrentDiagram: vi.fn(() => Promise.resolve({ ok: true })),
  getVersion: vi.fn(() => Promise.resolve({ data: {} })),
}))

describe('NodeOpList', () => {
  it('no renderiza nada con lista vacía', () => {
    const { container } = render(createElement(NodeOpList, { ops: [] }))
    expect(container.firstChild).toBeNull()
  })

  it('renderiza un item por operación con su etiqueta', () => {
    const ops: NodeOp[] = [
      { kind: 'add', label: 'Usuario' },
      { kind: 'update', label: 'Pedido' },
      { kind: 'delete', label: 'Carrito' },
    ]
    render(createElement(NodeOpList, { ops }))
    expect(screen.getByText('Usuario')).toBeInTheDocument()
    expect(screen.getByText('Pedido')).toBeInTheDocument()
    expect(screen.getByText('Carrito')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem').length).toBe(3)
  })
})

describe('DiagramThumb', () => {
  const types = ['auto', 'erd', 'uml_class', 'sequence', 'flowchart', 'architecture', 'state_machine', 'mindmap']
  for (const t of types) {
    it(`renderiza la miniatura del tipo ${t}`, () => {
      const { container } = render(createElement(DiagramThumb, { type: t }))
      expect(container.querySelector('svg')).toBeTruthy()
    })
  }

  it('tipo desconocido cae a la miniatura Auto', () => {
    const { container } = render(createElement(DiagramThumb, { type: 'no-existe' }))
    expect(container.querySelector('svg')).toBeTruthy()
  })
})

describe('ToolTray', () => {
  beforeEach(() => {
    useStore.setState({ toolTrace: [] })
    useUiStore.setState({ toolTrayExpanded: false })
  })

  it('no renderiza nada sin entradas de traza', () => {
    const { container } = render(createElement(ToolTray))
    expect(container.firstChild).toBeNull()
  })

  it('muestra el contador y, al expandir, las entradas con su etiqueta legible', () => {
    const trace: ToolTraceEntry[] = [
      { id: 't1', tool: 'add_node', args: { label: 'Usuario' }, status: 'ok' },
      { id: 't2', tool: 'apply_layout', args: {}, status: 'running' },
    ]
    useStore.setState({ toolTrace: trace })
    render(createElement(ToolTray))
    // Contador con el nº de entradas.
    expect(screen.getByText('2')).toBeInTheDocument()
    // Cerrado: las entradas no se ven aún.
    expect(screen.queryByText(/Añadiendo nodo/)).not.toBeInTheDocument()
    // Expandir.
    fireEvent.click(screen.getByText('Herramientas'))
    expect(screen.getByText('Añadiendo nodo «Usuario»')).toBeInTheDocument()
    expect(screen.getByText('Reorganizando el diagrama')).toBeInTheDocument()
  })
})

describe('TypeChoiceButtons', () => {
  beforeEach(() => {
    useStore.setState({ pendingTypeChoice: null })
  })

  it('no renderiza nada sin elección pendiente', () => {
    const { container } = render(
      createElement(TypeChoiceButtons, { onChoose: vi.fn() })
    )
    expect(container.firstChild).toBeNull()
  })

  it('renderiza una card por candidato y dispara onChoose al pulsar', () => {
    const choice: PendingTypeChoice = {
      question: '¿Secuencia o casos de uso?',
      options: [
        { label: 'Secuencia', value: 'sequence' },
        { label: 'Casos de uso', value: 'use_case' },
      ],
    }
    useStore.setState({ pendingTypeChoice: choice })
    const onChoose = vi.fn()
    render(createElement(TypeChoiceButtons, { onChoose }))
    expect(screen.getByText('¿Secuencia o casos de uso?')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBe(2)
    fireEvent.click(buttons[0])
    expect(onChoose).toHaveBeenCalledWith('sequence')
  })

  it('tras elegir, bloquea los demás botones (guard de doble submit)', () => {
    const choice: PendingTypeChoice = {
      question: 'Elige',
      options: [
        { label: 'ERD', value: 'erd' },
        { label: 'UML', value: 'uml_class' },
      ],
    }
    useStore.setState({ pendingTypeChoice: choice })
    const onChoose = vi.fn()
    render(createElement(TypeChoiceButtons, { onChoose }))
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[0])
    // Un segundo clic sobre el otro no debe re-disparar (chosen ya fijado).
    fireEvent.click(buttons[1])
    expect(onChoose).toHaveBeenCalledTimes(1)
    // Todos los botones quedan deshabilitados.
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true)
  })
})

describe('ChatPanel', () => {
  beforeEach(() => {
    useStore.setState({
      uiState: 'idle',
      activeOperation: null,
      liveOps: [],
      versions: [],
      currentVersionSeq: null,
      headVersionId: null,
      pendingClarification: null,
      pendingTypeChoice: null,
      toolTrace: [],
      currentDiagramId: null,
    })
  })

  it('estado vacío: muestra el EmptyState y el indicador de conexión', () => {
    render(
      createElement(ChatPanel, {
        connectionState: 'connected',
        onChooseDiagramType: vi.fn(),
      })
    )
    expect(screen.getByText('Operaciones')).toBeInTheDocument()
    expect(screen.getByText(/Conectado/)).toBeInTheDocument()
    expect(screen.getByText('Aún no hay operaciones')).toBeInTheDocument()
  })

  it('lista operaciones a partir de las versiones del store', () => {
    const versions: VersionMeta[] = [
      {
        id: 'v1',
        seq: 1,
        origin: 'generate',
        instruction: 'ERD de una tienda online',
        op_summary: { added: ['Usuario', 'Pedido'], updated: [], deleted: [], addedEdges: 1, deletedEdges: 0 },
        parent_version_id: null,
        created_at: '2026-01-01T00:00:00Z',
      },
    ]
    useStore.setState({ versions, headVersionId: 'v1', currentVersionSeq: 1 })
    render(
      createElement(ChatPanel, {
        connectionState: 'connected',
        onChooseDiagramType: vi.fn(),
      })
    )
    expect(screen.getByText('ERD de una tienda online')).toBeInTheDocument()
    expect(screen.getByText('Generación')).toBeInTheDocument()
    // La versión actual desactiva su botón de "volver".
    expect(screen.getByText('Versión actual')).toBeInTheDocument()
  })

  it('estado generating muestra la tarjeta En curso', () => {
    useStore.setState({ uiState: 'generating', activeOperation: 'Creando nodos…' })
    render(
      createElement(ChatPanel, {
        connectionState: 'connecting',
        onChooseDiagramType: vi.fn(),
      })
    )
    expect(screen.getByText('En curso…')).toBeInTheDocument()
    expect(screen.getByText('Creando nodos…')).toBeInTheDocument()
  })

  it('muestra la pregunta de clarificación pendiente del agente', () => {
    useStore.setState({
      pendingClarification: { question: '¿Qué entidades quieres incluir?', thread_id: 't1' } as never,
    })
    render(
      createElement(ChatPanel, {
        connectionState: 'connected',
        onChooseDiagramType: vi.fn(),
      })
    )
    expect(screen.getByText('El agente pregunta')).toBeInTheDocument()
    expect(screen.getByText('¿Qué entidades quieres incluir?')).toBeInTheDocument()
  })
})
