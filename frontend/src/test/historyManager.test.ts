import { beforeEach, describe, expect, it } from 'vitest'
import { beginHistoryInteraction, endHistoryInteraction } from '../store/historyManager'
import { useStore } from '../store/index'
import { useHistoryStore } from '../store/history'
import type { DiagramSchema } from '../types'

// historyManager mantiene estado a nivel de módulo (previousDiagram, suspended)
// y se suscribe a useStore al importarse. No hay reset directo de ese estado, así
// que cada test deja una "base" conocida llamando a endHistoryInteraction() (que
// resincroniza previousDiagram con el currentDiagram actual y limpia `suspended`).

const diagram = (title: string): DiagramSchema => ({
  title,
  diagram_type: 'erd',
  nodes: [],
  edges: [],
})

beforeEach(() => {
  useHistoryStore.setState({ past: [], future: [], canUndo: false, canRedo: false, _skipCapture: false })
})

describe('historyManager — captura automática vía suscripción', () => {
  it('un cambio de currentDiagram empuja el estado PREVIO al historial', () => {
    // Base: dejamos previousDiagram = d1 (sin suspensión).
    useStore.setState({ currentDiagram: diagram('d1') })
    endHistoryInteraction()
    useHistoryStore.setState({ past: [], canUndo: false })

    // Cambio real: el snapshot que se apila es el previo (d1).
    useStore.setState({ currentDiagram: diagram('d2') })
    const past = useHistoryStore.getState().past
    expect(past).toHaveLength(1)
    expect(past[0].title).toBe('d1')
  })

  it('una secuencia de N cambios produce N snapshots (uno por transición)', () => {
    useStore.setState({ currentDiagram: diagram('a') })
    endHistoryInteraction()
    useHistoryStore.setState({ past: [], canUndo: false })

    useStore.setState({ currentDiagram: diagram('b') })
    useStore.setState({ currentDiagram: diagram('c') })
    expect(useHistoryStore.getState().past.map((s) => s.title)).toEqual(['a', 'b'])
  })

  it('fijar el MISMO objeto no dispara captura (guarda de identidad)', () => {
    const shared = diagram('mismo')
    useStore.setState({ currentDiagram: shared })
    endHistoryInteraction()
    useHistoryStore.setState({ past: [], canUndo: false })

    // setState con la misma referencia: la suscripción compara current === previous.
    useStore.setState({ currentDiagram: shared })
    expect(useHistoryStore.getState().past).toHaveLength(0)
  })
})

describe('historyManager — gesto continuo (begin/end)', () => {
  it('begin captura UNA vez y suspende: los cambios intermedios no apilan más', () => {
    useStore.setState({ currentDiagram: diagram('base') })
    endHistoryInteraction()
    useHistoryStore.setState({ past: [], canUndo: false })

    beginHistoryInteraction() // apila 'base' una vez
    useStore.setState({ currentDiagram: diagram('mov1') })
    useStore.setState({ currentDiagram: diagram('mov2') })
    useStore.setState({ currentDiagram: diagram('mov3') })

    // Un único snapshot por todo el gesto.
    expect(useHistoryStore.getState().past.map((s) => s.title)).toEqual(['base'])

    endHistoryInteraction()
  })

  it('begin es idempotente: un segundo begin durante el gesto no apila otro snapshot', () => {
    useStore.setState({ currentDiagram: diagram('base') })
    endHistoryInteraction()
    useHistoryStore.setState({ past: [], canUndo: false })

    beginHistoryInteraction()
    beginHistoryInteraction() // no-op (ya suspendido)
    expect(useHistoryStore.getState().past).toHaveLength(1)

    endHistoryInteraction()
  })

  it('end reanuda la captura: el siguiente cambio vuelve a apilar', () => {
    useStore.setState({ currentDiagram: diagram('base') })
    endHistoryInteraction()
    useHistoryStore.setState({ past: [], canUndo: false })

    beginHistoryInteraction()
    useStore.setState({ currentDiagram: diagram('final') })
    endHistoryInteraction() // previousDiagram ← 'final'
    useHistoryStore.setState({ past: [], canUndo: false })

    useStore.setState({ currentDiagram: diagram('despues') })
    expect(useHistoryStore.getState().past.map((s) => s.title)).toEqual(['final'])
  })

  it('end sin begin previo es seguro (solo resincroniza la base)', () => {
    useStore.setState({ currentDiagram: diagram('x') })
    expect(() => endHistoryInteraction()).not.toThrow()
    useHistoryStore.setState({ past: [], canUndo: false })

    useStore.setState({ currentDiagram: diagram('y') })
    expect(useHistoryStore.getState().past.map((s) => s.title)).toEqual(['x'])
  })
})
