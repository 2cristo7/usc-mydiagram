import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { RefObject } from 'react'

// Mock de api para que updateNode (que internamente llama a schedulePersist) no
// dispare red. Además uiState != 'ready' evita el debounce, pero mockeamos por
// seguridad igualmente.
vi.mock('../lib/api', () => ({
  persistCurrentDiagram: vi.fn(() => Promise.resolve({ ok: true })),
  renameDiagram: vi.fn(() => Promise.resolve({ ok: true })),
}))

import { useNodeAttrEditor } from '../hooks/useNodeAttrEditor'
import { useStore } from '../store'

function makeRefs() {
  const containerRef = { current: document.createElement('div') } as RefObject<HTMLElement | null>
  const rowRefs = { current: [] as (HTMLInputElement | null)[] } as RefObject<(HTMLInputElement | null)[]>
  return { containerRef, rowRefs }
}

beforeEach(() => {
  useStore.setState({
    editingNodeId: null,
    nodes: [{ id: 'n1', label: 'Tabla', node_type: 'table' as never, attributes: ['id', 'nombre'] }],
    currentDiagram: null,
    uiState: 'idle',
  })
})

describe('useNodeAttrEditor — estado de edición', () => {
  it('isEditing deriva de editingNodeId === nodeId', () => {
    const refs = makeRefs()
    const { result, rerender } = renderHook(() =>
      useNodeAttrEditor('n1', 'Tabla', ['id', 'nombre'], refs),
    )
    expect(result.current.isEditing).toBe(false)
    act(() => useStore.getState().setEditingNodeId('n1'))
    rerender()
    expect(result.current.isEditing).toBe(true)
    act(() => useStore.getState().setEditingNodeId('otro'))
    rerender()
    expect(result.current.isEditing).toBe(false)
  })

  it('start() siembra borrador y fija editingNodeId', () => {
    const refs = makeRefs()
    const { result } = renderHook(() => useNodeAttrEditor('n1', 'Tabla', ['id', 'nombre'], refs))
    act(() => result.current.start())
    expect(useStore.getState().editingNodeId).toBe('n1')
    expect(result.current.name).toBe('Tabla')
    expect(result.current.attrs).toEqual(['id', 'nombre'])
  })

  it('cancel() limpia editingNodeId', () => {
    const refs = makeRefs()
    const { result } = renderHook(() => useNodeAttrEditor('n1', 'Tabla', ['id', 'nombre'], refs))
    act(() => result.current.start())
    act(() => result.current.cancel())
    expect(useStore.getState().editingNodeId).toBeNull()
  })
})

describe('useNodeAttrEditor — filas', () => {
  it('addRow añade una fila vacía', () => {
    const refs = makeRefs()
    const { result } = renderHook(() => useNodeAttrEditor('n1', 'Tabla', ['id'], refs))
    act(() => result.current.start())
    act(() => result.current.addRow())
    expect(result.current.attrs).toEqual(['id', ''])
  })

  it('updateRow reemplaza por índice', () => {
    const refs = makeRefs()
    const { result } = renderHook(() => useNodeAttrEditor('n1', 'Tabla', ['id', 'nombre'], refs))
    act(() => result.current.start())
    act(() => result.current.updateRow(1, 'email'))
    expect(result.current.attrs).toEqual(['id', 'email'])
  })

  it('deleteRow elimina por índice', () => {
    const refs = makeRefs()
    const { result } = renderHook(() => useNodeAttrEditor('n1', 'Tabla', ['id', 'nombre'], refs))
    act(() => result.current.start())
    act(() => result.current.deleteRow(0))
    expect(result.current.attrs).toEqual(['nombre'])
  })

  it('setName cambia el nombre del borrador', () => {
    const refs = makeRefs()
    const { result } = renderHook(() => useNodeAttrEditor('n1', 'Tabla', ['id'], refs))
    act(() => result.current.start())
    act(() => result.current.setName('Usuarios'))
    expect(result.current.name).toBe('Usuarios')
  })
})

describe('useNodeAttrEditor — commit', () => {
  it('commitAndStop con cambios llama updateNode con label trim + attrs limpios + hidden', () => {
    const updateNode = vi.fn()
    useStore.setState({ updateNode } as never)
    const refs = makeRefs()
    const { result } = renderHook(() =>
      useNodeAttrEditor('n1', 'Tabla', ['id'], { ...refs, hiddenAttributes: ['group:auth'] }),
    )
    act(() => result.current.start())
    act(() => result.current.setName('  Usuarios  '))
    act(() => result.current.updateRow(0, '  email  '))
    act(() => result.current.addRow())
    act(() => result.current.updateRow(1, '   ')) // fila en blanco → se filtra
    act(() => result.current.commitAndStop())
    expect(updateNode).toHaveBeenCalledWith('n1', {
      label: 'Usuarios',
      attributes: ['email', 'group:auth'],
    })
    expect(useStore.getState().editingNodeId).toBeNull()
  })

  it('commitAndStop sin cambios NO llama a updateNode (evita re-layout espurio)', () => {
    const updateNode = vi.fn()
    useStore.setState({ updateNode } as never)
    const refs = makeRefs()
    const { result } = renderHook(() => useNodeAttrEditor('n1', 'Tabla', ['id', 'nombre'], refs))
    act(() => result.current.start())
    act(() => result.current.commitAndStop())
    expect(updateNode).not.toHaveBeenCalled()
    expect(useStore.getState().editingNodeId).toBeNull()
  })

  it('nombre vacío cae al label original (no se persiste un nodo sin etiqueta)', () => {
    const updateNode = vi.fn()
    useStore.setState({ updateNode } as never)
    const refs = makeRefs()
    const { result } = renderHook(() => useNodeAttrEditor('n1', 'Tabla', ['id'], refs))
    act(() => result.current.start())
    act(() => result.current.setName('   ')) // vacío
    act(() => result.current.updateRow(0, 'pk')) // cambia un atributo → hay cambio
    act(() => result.current.commitAndStop())
    // label NO va en el payload (cleanName vacío), pero el cambio se persiste con
    // los atributos; persistedLabel internamente es el original 'Tabla'.
    expect(updateNode).toHaveBeenCalledWith('n1', { attributes: ['pk'] })
  })
})

describe('useNodeAttrEditor — re-siembra al cambiar props', () => {
  it('un cambio de label por fuera re-sincroniza el borrador (edición del agente)', () => {
    const refs = makeRefs()
    const { result, rerender } = renderHook(
      ({ label, attrs }: { label: string; attrs: string[] }) =>
        useNodeAttrEditor('n1', label, attrs, refs),
      { initialProps: { label: 'Tabla', attrs: ['id'] } },
    )
    act(() => result.current.start())
    expect(result.current.name).toBe('Tabla')
    // El agente renombra el nodo: las props cambian → el borrador se re-siembra.
    rerender({ label: 'TablaRenombrada', attrs: ['id', 'fk'] })
    expect(result.current.name).toBe('TablaRenombrada')
    expect(result.current.attrs).toEqual(['id', 'fk'])
  })
})

describe('useNodeAttrEditor — cierre por clic fuera / Escape', () => {
  it('mousedown fuera del contenedor mientras edita confirma (commitAndStop)', () => {
    const updateNode = vi.fn()
    useStore.setState({ updateNode } as never)
    const refs = makeRefs()
    document.body.appendChild(refs.containerRef.current!)
    const { result } = renderHook(() => useNodeAttrEditor('n1', 'Tabla', ['id'], refs))
    act(() => result.current.start())
    act(() => result.current.setName('NuevoNombre'))
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    act(() => {
      outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(updateNode).toHaveBeenCalled()
    expect(useStore.getState().editingNodeId).toBeNull()
    document.body.removeChild(refs.containerRef.current!)
    document.body.removeChild(outside)
  })

  it('mousedown DENTRO del contenedor no cierra la edición', () => {
    const updateNode = vi.fn()
    useStore.setState({ updateNode } as never)
    const refs = makeRefs()
    document.body.appendChild(refs.containerRef.current!)
    const inner = document.createElement('input')
    refs.containerRef.current!.appendChild(inner)
    const { result } = renderHook(() => useNodeAttrEditor('n1', 'Tabla', ['id'], refs))
    act(() => result.current.start())
    act(() => {
      inner.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(useStore.getState().editingNodeId).toBe('n1')
    expect(updateNode).not.toHaveBeenCalled()
    document.body.removeChild(refs.containerRef.current!)
  })

  it('Escape cancela la edición', () => {
    const updateNode = vi.fn()
    useStore.setState({ updateNode } as never)
    const refs = makeRefs()
    const { result } = renderHook(() => useNodeAttrEditor('n1', 'Tabla', ['id'], refs))
    act(() => result.current.start())
    act(() => result.current.setName('algo')) // cambio sin guardar
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(useStore.getState().editingNodeId).toBeNull()
    expect(updateNode).not.toHaveBeenCalled()
  })
})
