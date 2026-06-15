import { useEffect } from 'react'
import { useHistoryStore } from '../store/history'

// Atajos de teclado para deshacer/rehacer:
//   Ctrl+Z / Cmd+Z          → deshacer
//   Ctrl+Shift+Z / Cmd+Shift+Z → rehacer
// Se ignoran mientras se escribe en un campo de texto (input, textarea o
// contenteditable) para no pisar el deshacer nativo de la edición de texto.
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}

export function useUndoRedoShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key.toLowerCase() !== 'z') return
      if (isEditableTarget(e.target)) return

      e.preventDefault()
      const history = useHistoryStore.getState()
      if (e.shiftKey) {
        if (history.canRedo) history.redo()
      } else {
        if (history.canUndo) history.undo()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
