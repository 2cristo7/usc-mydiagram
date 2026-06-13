import { useStore } from './index'
import { useHistoryStore } from './history'
import type { DiagramSchema } from '../types'

let previousDiagram: DiagramSchema | null = null

useStore.subscribe((state) => {
  const current = state.currentDiagram
  if (current === previousDiagram) return
  if (previousDiagram !== null) {
    useHistoryStore.getState().pushSnapshot(previousDiagram)
  }
  previousDiagram = current
})
