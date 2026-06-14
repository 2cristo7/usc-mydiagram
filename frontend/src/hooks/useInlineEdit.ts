import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react'
import { useStore } from '../store'

interface UseInlineEditOptions {
  initialValue: string
  onCommit: (newValue: string) => void
  selectAllOnEnter?: boolean
  selected?: boolean
  // Id del nodo si el hook edita un nodo. Habilita la "edición a petición": el
  // menú contextual fija editRequestNodeId en el store y el nodo correspondiente
  // arranca su edición inline (los edges no pasan nodeId → no participan).
  nodeId?: string
}

interface UseInlineEditReturn {
  isEditing: boolean
  editValue: string
  startEditing: () => void
  stopEditing: () => void
  inputProps: {
    value: string
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => void
    onKeyDown: (e: React.KeyboardEvent) => void
    onBlur: () => void
    autoFocus: boolean
    ref: (el: HTMLInputElement | HTMLTextAreaElement | null) => void
    // Ancho calculado al vuelo a partir del texto (ver measureTextWidth): el
    // input/textarea ocupa EXACTAMENTE lo que mide su contenido, por lo que el
    // nodo no salta de tamaño al entrar/salir de edición. undefined = sin medir
    // aún (no editando).
    style: { width: number | undefined }
  }
  containerProps: {
    onDoubleClick: (e: React.MouseEvent) => void
    className: string
  }
}

// Mide el ancho de pixel del texto con la MISMA tipografía que el control de
// edición (font computado del propio elemento), usando un canvas reutilizable.
// Es lo que permite que el ancho del input siga al contenido sin recurrir al
// tamaño intrínseco por defecto del <input>/<textarea> (~20 cols), causa del
// "salto" horizontal al hacer doble clic.
let _measureCanvas: HTMLCanvasElement | null = null
function measureTextWidth(text: string, el: HTMLElement): number {
  if (!_measureCanvas) _measureCanvas = document.createElement('canvas')
  const ctx = _measureCanvas.getContext('2d')
  if (!ctx) return 0
  const cs = getComputedStyle(el)
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
  return ctx.measureText(text).width
}

export function useInlineEdit({
  initialValue,
  onCommit,
  selectAllOnEnter: _selectAllOnEnter = true,
  selected = false,
  nodeId,
}: UseInlineEditOptions): UseInlineEditReturn {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(initialValue)
  // Prevents double-commit from blur firing after Enter
  const committedRef = useRef(false)
  // Elemento de edición vivo + ancho medido a partir de su contenido.
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const [editWidth, setEditWidth] = useState<number | undefined>(undefined)

  const startEditing = useCallback(() => {
    committedRef.current = false
    setEditValue(initialValue)
    setIsEditing(true)
  }, [initialValue])

  const commit = useCallback(
    (value: string) => {
      if (committedRef.current) return
      committedRef.current = true
      setIsEditing(false)
      onCommit(value)
    },
    [onCommit]
  )

  const discard = useCallback(() => {
    committedRef.current = true
    setIsEditing(false)
    setEditValue(initialValue)
  }, [initialValue])

  const stopEditing = useCallback(() => {
    discard()
  }, [discard])

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      setEditValue(e.target.value)
    },
    []
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        commit(editValue)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        discard()
      }
    },
    [editValue, commit, discard]
  )

  const onBlur = useCallback(() => {
    commit(editValue)
  }, [editValue, commit])

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    startEditing()
  }, [startEditing])

  useEffect(() => {
    if (!selected || isEditing) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key.length !== 1) return
      committedRef.current = false
      setEditValue(e.key)
      setIsEditing(true)
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selected, isEditing])

  // Ancho dinámico: se recalcula en cada tecla (y al arrancar la edición, ya con
  // el valor inicial → el ancho de partida coincide con el del texto estático, sin
  // salto). useLayoutEffect mide antes de pintar para que no haya parpadeo.
  useLayoutEffect(() => {
    if (!isEditing) {
      setEditWidth(undefined)
      return
    }
    const el = inputRef.current
    if (!el) return
    // box-sizing: border-box (preflight de Tailwind) ⇒ el width debe INCLUIR
    // padding y borde, o el texto se recortaría en inputs con px-* (p. ej. el
    // rombo de decisión). +6 px de margen para el cursor y el último glifo.
    const cs = getComputedStyle(el)
    const extra =
      parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) +
      parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth)
    setEditWidth(Math.ceil(measureTextWidth(editValue || ' ', el)) + extra + 6)
  }, [isEditing, editValue])

  // Edición a petición desde el menú contextual (solo nodos): cuando el store
  // marca este nodeId, arrancamos la edición y consumimos la petición.
  const editRequestNodeId = useStore((s) => s.editRequestNodeId)
  const requestNodeEdit = useStore((s) => s.requestNodeEdit)
  useEffect(() => {
    if (nodeId && editRequestNodeId === nodeId && !isEditing) {
      requestNodeEdit(null)
      startEditing()
    }
  }, [nodeId, editRequestNodeId, isEditing, requestNodeEdit, startEditing])

  return {
    isEditing,
    editValue,
    startEditing,
    stopEditing,
    inputProps: {
      value: editValue,
      onChange,
      onKeyDown,
      onBlur,
      autoFocus: isEditing,
      ref: (el: HTMLInputElement | HTMLTextAreaElement | null) => {
        inputRef.current = el
      },
      style: { width: editWidth },
    },
    containerProps: {
      onDoubleClick,
      className: isEditing ? 'nopan nodrag nowheel' : '',
    },
  }
}
