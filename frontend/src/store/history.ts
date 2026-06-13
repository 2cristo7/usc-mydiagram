import { create } from 'zustand'
import { useStore } from './index'
import type { DiagramSchema } from '../types'

type Snapshot = DiagramSchema

export interface HistoryStore {
  past: Snapshot[]
  future: Snapshot[]
  _skipCapture: boolean
  canUndo: boolean
  canRedo: boolean
  pushSnapshot: (snapshot: Snapshot) => void
  undo: () => void
  redo: () => void
  reset: () => void
}

const MAX_HISTORY = 50

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  past: [],
  future: [],
  _skipCapture: false,
  canUndo: false,
  canRedo: false,

  pushSnapshot: (snapshot) => {
    if (get()._skipCapture) return
    set((s) => {
      const newPast = [...s.past, snapshot].slice(-MAX_HISTORY)
      return { past: newPast, future: [], canUndo: newPast.length > 0, canRedo: false }
    })
  },

  undo: () => {
    const { past } = get()
    if (past.length === 0) return
    const currentDiagram = useStore.getState().currentDiagram
    if (!currentDiagram) return
    const previous = past[past.length - 1]
    set((s) => {
      const newPast = s.past.slice(0, -1)
      const newFuture = [currentDiagram, ...s.future]
      return {
        past: newPast,
        future: newFuture,
        _skipCapture: true,
        canUndo: newPast.length > 0,
        canRedo: true,
      }
    })
    useStore.getState().setCurrentDiagram(previous)
    set({ _skipCapture: false })
  },

  redo: () => {
    const { future } = get()
    if (future.length === 0) return
    const currentDiagram = useStore.getState().currentDiagram
    if (!currentDiagram) return
    const next = future[0]
    set((s) => {
      const newPast = [...s.past, currentDiagram]
      const newFuture = s.future.slice(1)
      return {
        past: newPast,
        future: newFuture,
        _skipCapture: true,
        canUndo: true,
        canRedo: newFuture.length > 0,
      }
    })
    useStore.getState().setCurrentDiagram(next)
    set({ _skipCapture: false })
  },

  reset: () => set({ past: [], future: [], canUndo: false, canRedo: false }),
}))
