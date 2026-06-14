import { useState, useRef, useCallback, useEffect } from 'react'

interface UseInlineEditOptions {
  initialValue: string
  onCommit: (newValue: string) => void
  selectAllOnEnter?: boolean
  selected?: boolean
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
  }
  containerProps: {
    onDoubleClick: (e: React.MouseEvent) => void
    className: string
  }
}

export function useInlineEdit({
  initialValue,
  onCommit,
  selectAllOnEnter: _selectAllOnEnter = true,
  selected = false,
}: UseInlineEditOptions): UseInlineEditReturn {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(initialValue)
  // Prevents double-commit from blur firing after Enter
  const committedRef = useRef(false)

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
    },
    containerProps: {
      onDoubleClick,
      className: isEditing ? 'nopan nodrag nowheel' : '',
    },
  }
}
