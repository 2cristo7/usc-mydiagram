import { beforeEach, describe, expect, it } from 'vitest'
import { useHistoryStore } from '../store/history'
import { useStore } from '../store/index'
import type { DiagramSchema } from '../types'

const snap = (title: string): DiagramSchema => ({
  title,
  diagram_type: 'erd',
  nodes: [],
  edges: [],
})

beforeEach(() => {
  useHistoryStore.setState({ past: [], future: [], canUndo: false, canRedo: false, _skipCapture: false })
  useStore.setState({ currentDiagram: null, nodes: [], edges: [] })
})

describe('history store', () => {
  it('undo restores previous snapshot and moves current to future', () => {
    const previous = snap('previous')
    const current = snap('current')

    useHistoryStore.setState({ past: [previous], canUndo: true })
    useStore.getState().setCurrentDiagram(current)

    useHistoryStore.getState().undo()

    expect(useStore.getState().currentDiagram).toEqual(previous)
    expect(useHistoryStore.getState().future[0]).toEqual(current)
    expect(useHistoryStore.getState().past).toHaveLength(0)
  })

  it('redo is symmetric', () => {
    const next = snap('next')
    const current = snap('current')

    useHistoryStore.setState({ future: [next], canRedo: true })
    useStore.getState().setCurrentDiagram(current)

    useHistoryStore.getState().redo()

    expect(useStore.getState().currentDiagram).toEqual(next)
    expect(useHistoryStore.getState().past[useHistoryStore.getState().past.length - 1]).toEqual(current)
    expect(useHistoryStore.getState().future).toHaveLength(0)
  })

  it('reset clears both stacks', () => {
    useHistoryStore.setState({ past: [snap('a'), snap('b')], future: [snap('c')], canUndo: true, canRedo: true })

    useHistoryStore.getState().reset()

    expect(useHistoryStore.getState().past).toEqual([])
    expect(useHistoryStore.getState().future).toEqual([])
  })

  it('canUndo/canRedo reflect stack state', () => {
    expect(useHistoryStore.getState().canUndo).toBe(false)
    expect(useHistoryStore.getState().canRedo).toBe(false)

    useHistoryStore.setState({ past: [snap('x')], canUndo: true })
    expect(useHistoryStore.getState().canUndo).toBe(true)

    useHistoryStore.setState({ future: [snap('y')], canRedo: true })
    expect(useHistoryStore.getState().canRedo).toBe(true)
  })
})
