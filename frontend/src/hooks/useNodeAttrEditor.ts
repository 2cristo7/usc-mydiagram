import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useStore } from '../store'

// Firma estable de (nombre, atributos visibles) para detectar cambios por valor.
const sig = (label: string, attributes: string[]) => JSON.stringify([label, attributes])

interface UseNodeAttrEditorOpts {
  // Refs PROPIEDAD DEL NODO (creados con useRef en el componente y puestos en
  // `ref={...}`). El hook solo los lee en efectos/handlers, nunca en render, para no
  // chocar con la regla react-hooks/refs ni devolver refs (que tintarían el objeto).
  containerRef: RefObject<HTMLElement | null>
  rowRefs: RefObject<(HTMLInputElement | null)[]>
  // Atributos del nodo que NO se muestran ni se editan pero deben CONSERVARSE al
  // guardar (p. ej. `group:` en arquitectura): se reanexan en el commit.
  hiddenAttributes?: string[]
}

// Estado y manejadores para la EDICIÓN INLINE de un nodo con atributos (tabla ERD,
// iconos de arquitectura). El nodo renderiza inputs en su PROPIO cuerpo —no hay panel
// flotante—; este hook centraliza el borrador local, el alta/baja de filas, el
// confirmar/cancelar y el cierre por clic-fuera/Escape. Cada nodo decide la
// presentación (cabecera, filas, etc.) usando lo que devuelve.
export function useNodeAttrEditor(
  nodeId: string,
  label: string,
  attributes: string[],
  opts: UseNodeAttrEditorOpts,
) {
  const { containerRef, rowRefs, hiddenAttributes = [] } = opts
  const updateNode = useStore((s) => s.updateNode)
  const editingNodeId = useStore((s) => s.editingNodeId)
  const setEditingNodeId = useStore((s) => s.setEditingNodeId)
  const isEditing = editingNodeId === nodeId

  // Borrador local: única fuente de verdad de los inputs mientras se edita (sin
  // saltos de cursor). En vista, el nodo pinta directamente desde props.
  const [name, setName] = useState(label)
  const [attrs, setAttrs] = useState<string[]>(attributes)
  // Firma que coincide con el borrador. Re-siembra el borrador cuando el nodo cambia
  // por FUERA (edición del agente) sin pisar la edición propia, y detecta "sin
  // cambios" al confirmar. En estado (no ref) para poder leerla durante el render.
  const [syncedKey, setSyncedKey] = useState(() => sig(label, attributes))
  // Índice de la fila recién añadida que debe enfocarse tras pintarse (interno).
  const focusOnRender = useRef<number | null>(null)

  // Re-siembra el borrador desde las props cuando difieren de la última versión
  // sincronizada. Patrón "ajustar estado al cambiar props" (durante el render, no en
  // efecto): converge porque tras re-sembrar syncedKey ya coincide con las props.
  const propsKey = sig(label, attributes)
  if (propsKey !== syncedKey) {
    setSyncedKey(propsKey)
    setName(label)
    setAttrs(attributes)
  }

  const start = useCallback(() => {
    // Arranca el borrador desde los valores actuales (cubre el caso de una edición
    // anterior cancelada cuyo borrador quedó sucio sin que cambiaran las props).
    setName(label)
    setAttrs(attributes)
    setSyncedKey(sig(label, attributes))
    setEditingNodeId(nodeId)
  }, [label, attributes, nodeId, setEditingNodeId])

  // Cancela: sale sin guardar. El borrador se re-siembra al volver a entrar (start).
  const cancel = useCallback(() => {
    setEditingNodeId(null)
  }, [setEditingNodeId])

  const commitAndStop = useCallback(() => {
    const cleanName = name.trim()
    const cleanAttrs = attrs.map((a) => a.trim()).filter(Boolean)
    const persistedLabel = cleanName || label
    setSyncedKey(sig(persistedLabel, cleanAttrs))
    // No-op si nada cambió respecto al estado actual del nodo: NO tocamos el store,
    // evitando un re-layout/re-ruteo espurio (el "flash" al salir sin cambios). El
    // nombre vacío no se persiste (un nodo sin etiqueta rompe la legibilidad).
    if (sig(persistedLabel, cleanAttrs) !== sig(label, attributes)) {
      updateNode(nodeId, {
        ...(cleanName ? { label: cleanName } : {}),
        attributes: [...cleanAttrs, ...hiddenAttributes],
      })
    }
    setEditingNodeId(null)
  }, [name, attrs, label, attributes, hiddenAttributes, nodeId, updateNode, setEditingNodeId])

  // Cierre por clic FUERA del nodo (guarda) o Escape (cancela). Captura: React Flow
  // corta la propagación del mousedown sobre los nodos, así un clic en otro nodo
  // también cierra.
  useEffect(() => {
    if (!isEditing) return
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        commitAndStop()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        cancel()
      }
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [isEditing, commitAndStop, cancel, containerRef])

  // Enfoca la fila recién añadida una vez React la ha pintado.
  useEffect(() => {
    if (focusOnRender.current === null) return
    rowRefs.current?.[focusOnRender.current]?.focus()
    focusOnRender.current = null
  })

  const addRow = useCallback(() => {
    setAttrs((prev) => {
      focusOnRender.current = prev.length
      return [...prev, '']
    })
  }, [])

  const updateRow = useCallback((i: number, value: string) => {
    setAttrs((prev) => prev.map((a, idx) => (idx === i ? value : a)))
  }, [])

  const deleteRow = useCallback((i: number) => {
    setAttrs((prev) => prev.filter((_, idx) => idx !== i))
  }, [])

  return { isEditing, name, attrs, setName, addRow, updateRow, deleteRow, start, cancel, commitAndStop }
}
