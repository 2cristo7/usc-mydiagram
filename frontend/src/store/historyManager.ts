import { useStore } from './index'
import { useHistoryStore } from './history'
import type { DiagramSchema } from '../types'

let previousDiagram: DiagramSchema | null = null
// Durante un arrastre continuo (mover un nodo, deslizar un waypoint o un extremo
// de arista) currentDiagram cambia en cada pixel. Mientras esta bandera está
// activa, la suscripción NO empuja snapshots intermedios: solo actualiza la
// referencia base. Así un gesto entero produce UNA sola entrada de historial.
let suspended = false

useStore.subscribe((state) => {
  const current = state.currentDiagram
  if (current === previousDiagram) return
  if (!suspended && previousDiagram !== null) {
    useHistoryStore.getState().pushSnapshot(previousDiagram)
  }
  previousDiagram = current
})

// Inicio de un gesto continuo: captura UNA vez el estado previo (para que
// deshacer vuelva ahí) y suspende la captura automática hasta endHistoryInteraction.
// Idempotente: si ya hay un gesto en curso, no hace nada (permite anidar, p. ej.
// insertar un waypoint en un midpoint y arrastrarlo a continuación).
// Llamar SOLO justo antes del primer cambio real, para no crear una entrada
// espuria cuando el gesto resulta ser un simple clic sin movimiento.
export function beginHistoryInteraction() {
  if (suspended) return
  if (previousDiagram !== null) {
    useHistoryStore.getState().pushSnapshot(previousDiagram)
  }
  suspended = true
}

// Fin del gesto: reanuda la captura automática y resincroniza la referencia base
// con el estado final. Seguro de llamar aunque no se haya empezado ningún gesto.
export function endHistoryInteraction() {
  suspended = false
  previousDiagram = useStore.getState().currentDiagram
}
