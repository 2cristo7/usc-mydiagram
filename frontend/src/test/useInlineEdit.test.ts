import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// toast.warning se dispara al confirmar un valor vacío.
const h = vi.hoisted(() => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))
vi.mock('../store/toast', () => ({ toast: h.toast }))

import { useInlineEdit } from '../hooks/useInlineEdit'
import { useStore } from '../store'

beforeEach(() => {
  vi.clearAllMocks()
  useStore.setState({ editRequestNodeId: null })
})

// Atajo: dispara un keydown global con la tecla dada.
function fireDocKeyDown(key: string, mods: Partial<KeyboardEventInit> = {}) {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...mods }))
  })
}

describe('useInlineEdit — edición básica', () => {
  it('startEditing entra en edición con el valor inicial', () => {
    const { result } = renderHook(() => useInlineEdit({ initialValue: 'Nodo A', onCommit: vi.fn() }))
    expect(result.current.isEditing).toBe(false)
    act(() => result.current.startEditing())
    expect(result.current.isEditing).toBe(true)
    expect(result.current.editValue).toBe('Nodo A')
  })

  it('onChange actualiza editValue', () => {
    const { result } = renderHook(() => useInlineEdit({ initialValue: 'A', onCommit: vi.fn() }))
    act(() => result.current.startEditing())
    act(() => result.current.inputProps.onChange({ target: { value: 'Nuevo' } } as never))
    expect(result.current.editValue).toBe('Nuevo')
  })

  it('commit con valor no vacío llama a onCommit y sale de edición (Enter)', () => {
    const onCommit = vi.fn()
    const { result } = renderHook(() => useInlineEdit({ initialValue: 'A', onCommit }))
    act(() => result.current.startEditing())
    act(() => result.current.inputProps.onChange({ target: { value: 'B' } } as never))
    act(() => result.current.inputProps.onKeyDown({ key: 'Enter', shiftKey: false, preventDefault: vi.fn() } as never))
    expect(onCommit).toHaveBeenCalledWith('B')
    expect(result.current.isEditing).toBe(false)
  })

  it('commit con valor vacío descarta, avisa con toast.warning y NO llama a onCommit', () => {
    const onCommit = vi.fn()
    const { result } = renderHook(() => useInlineEdit({ initialValue: 'A', onCommit }))
    act(() => result.current.startEditing())
    act(() => result.current.inputProps.onChange({ target: { value: '   ' } } as never))
    act(() => result.current.inputProps.onKeyDown({ key: 'Enter', shiftKey: false, preventDefault: vi.fn() } as never))
    expect(onCommit).not.toHaveBeenCalled()
    expect(h.toast.warning).toHaveBeenCalledWith('El nombre no puede estar vacío.')
    expect(result.current.isEditing).toBe(false)
    expect(result.current.editValue).toBe('A')
  })

  it('Escape descarta sin llamar onCommit y restaura el valor inicial', () => {
    const onCommit = vi.fn()
    const { result } = renderHook(() => useInlineEdit({ initialValue: 'A', onCommit }))
    act(() => result.current.startEditing())
    act(() => result.current.inputProps.onChange({ target: { value: 'cambiado' } } as never))
    act(() => result.current.inputProps.onKeyDown({ key: 'Escape', preventDefault: vi.fn() } as never))
    expect(onCommit).not.toHaveBeenCalled()
    expect(result.current.isEditing).toBe(false)
    expect(result.current.editValue).toBe('A')
  })

  it('Shift+Enter no confirma (permite salto de línea)', () => {
    const onCommit = vi.fn()
    const { result } = renderHook(() => useInlineEdit({ initialValue: 'A', onCommit }))
    act(() => result.current.startEditing())
    const preventDefault = vi.fn()
    act(() => result.current.inputProps.onKeyDown({ key: 'Enter', shiftKey: true, preventDefault } as never))
    expect(onCommit).not.toHaveBeenCalled()
    expect(result.current.isEditing).toBe(true)
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('onBlur confirma', () => {
    const onCommit = vi.fn()
    const { result } = renderHook(() => useInlineEdit({ initialValue: 'A', onCommit }))
    act(() => result.current.startEditing())
    act(() => result.current.inputProps.onChange({ target: { value: 'B' } } as never))
    act(() => result.current.inputProps.onBlur())
    expect(onCommit).toHaveBeenCalledWith('B')
  })

  it('guarda anti doble-commit: Enter y luego blur → onCommit una sola vez', () => {
    const onCommit = vi.fn()
    const { result } = renderHook(() => useInlineEdit({ initialValue: 'A', onCommit }))
    act(() => result.current.startEditing())
    act(() => result.current.inputProps.onChange({ target: { value: 'B' } } as never))
    act(() => result.current.inputProps.onKeyDown({ key: 'Enter', shiftKey: false, preventDefault: vi.fn() } as never))
    act(() => result.current.inputProps.onBlur())
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('onDoubleClick arranca la edición y para la propagación', () => {
    const { result } = renderHook(() => useInlineEdit({ initialValue: 'A', onCommit: vi.fn() }))
    const stopPropagation = vi.fn()
    act(() => result.current.containerProps.onDoubleClick({ stopPropagation } as never))
    expect(result.current.isEditing).toBe(true)
    expect(stopPropagation).toHaveBeenCalled()
    expect(result.current.containerProps.className).toContain('nodrag')
  })
})

describe('useInlineEdit — efecto de empezar a teclear estando seleccionado', () => {
  it('un carácter mientras está selected (y no editando) arranca la edición con ese carácter', () => {
    const { result } = renderHook(() => useInlineEdit({ initialValue: 'A', onCommit: vi.fn(), selected: true }))
    fireDocKeyDown('x')
    expect(result.current.isEditing).toBe(true)
    expect(result.current.editValue).toBe('x')
  })

  it('teclas con modificador se ignoran', () => {
    const { result } = renderHook(() => useInlineEdit({ initialValue: 'A', onCommit: vi.fn(), selected: true }))
    fireDocKeyDown('x', { ctrlKey: true })
    fireDocKeyDown('y', { metaKey: true })
    fireDocKeyDown('z', { altKey: true })
    expect(result.current.isEditing).toBe(false)
  })

  it('teclas multi-carácter (Enter, ArrowLeft) se ignoran', () => {
    const { result } = renderHook(() => useInlineEdit({ initialValue: 'A', onCommit: vi.fn(), selected: true }))
    fireDocKeyDown('Enter')
    fireDocKeyDown('ArrowLeft')
    expect(result.current.isEditing).toBe(false)
  })

  it('si no está selected, teclear no arranca la edición', () => {
    const { result } = renderHook(() => useInlineEdit({ initialValue: 'A', onCommit: vi.fn(), selected: false }))
    fireDocKeyDown('x')
    expect(result.current.isEditing).toBe(false)
  })
})

describe('useInlineEdit — edición a petición (editRequestNodeId)', () => {
  it('al fijar el store editRequestNodeId con el nodeId, el hook arranca y consume la petición', () => {
    const { result } = renderHook(() => useInlineEdit({ initialValue: 'A', onCommit: vi.fn(), nodeId: 'n1' }))
    expect(result.current.isEditing).toBe(false)
    act(() => useStore.getState().requestNodeEdit('n1'))
    expect(result.current.isEditing).toBe(true)
    // La petición se limpió (consumida).
    expect(useStore.getState().editRequestNodeId).toBeNull()
  })

  it('una petición para OTRO nodeId no arranca la edición', () => {
    const { result } = renderHook(() => useInlineEdit({ initialValue: 'A', onCommit: vi.fn(), nodeId: 'n1' }))
    act(() => useStore.getState().requestNodeEdit('otro'))
    expect(result.current.isEditing).toBe(false)
    expect(useStore.getState().editRequestNodeId).toBe('otro')
  })

  it('sin nodeId (edge) la petición se ignora', () => {
    const { result } = renderHook(() => useInlineEdit({ initialValue: 'A', onCommit: vi.fn() }))
    act(() => useStore.getState().requestNodeEdit('n1'))
    expect(result.current.isEditing).toBe(false)
  })
})

describe('useInlineEdit — medición de ancho (ref real)', () => {
  it('adjuntar un input real vía ref no rompe el layout effect', () => {
    const { result } = renderHook(() => useInlineEdit({ initialValue: 'A', onCommit: vi.fn() }))
    const input = document.createElement('input')
    document.body.appendChild(input)
    act(() => result.current.inputProps.ref(input))
    act(() => result.current.startEditing())
    // En jsdom canvas.getContext puede ser null → width queda definido o undefined,
    // pero el hook no debe lanzar.
    expect(result.current.isEditing).toBe(true)
    document.body.removeChild(input)
  })
})
