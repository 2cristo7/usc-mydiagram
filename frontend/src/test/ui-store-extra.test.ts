import { beforeEach, describe, expect, it } from 'vitest'
import { useUiStore } from '../store/ui'

beforeEach(() => {
  useUiStore.setState({
    nodePaletteOpen: false,
    canvasLocked: false,
    gridEnabled: false,
    promptFocusNonce: 0,
    generationError: null,
  })
})

describe('ui store — controles del lienzo y prompt', () => {
  it('setNodePaletteOpen fija el valor', () => {
    useUiStore.getState().setNodePaletteOpen(true)
    expect(useUiStore.getState().nodePaletteOpen).toBe(true)
    useUiStore.getState().setNodePaletteOpen(false)
    expect(useUiStore.getState().nodePaletteOpen).toBe(false)
  })

  it('toggleNodePalette alterna el estado', () => {
    useUiStore.getState().toggleNodePalette()
    expect(useUiStore.getState().nodePaletteOpen).toBe(true)
    useUiStore.getState().toggleNodePalette()
    expect(useUiStore.getState().nodePaletteOpen).toBe(false)
  })

  it('toggleCanvasLock alterna el bloqueo del lienzo', () => {
    expect(useUiStore.getState().canvasLocked).toBe(false)
    useUiStore.getState().toggleCanvasLock()
    expect(useUiStore.getState().canvasLocked).toBe(true)
    useUiStore.getState().toggleCanvasLock()
    expect(useUiStore.getState().canvasLocked).toBe(false)
  })

  it('toggleGrid alterna el snapping', () => {
    expect(useUiStore.getState().gridEnabled).toBe(false)
    useUiStore.getState().toggleGrid()
    expect(useUiStore.getState().gridEnabled).toBe(true)
    useUiStore.getState().toggleGrid()
    expect(useUiStore.getState().gridEnabled).toBe(false)
  })

  it('focusPrompt incrementa el nonce en cada llamada (permite reenfoque repetido)', () => {
    expect(useUiStore.getState().promptFocusNonce).toBe(0)
    useUiStore.getState().focusPrompt()
    expect(useUiStore.getState().promptFocusNonce).toBe(1)
    useUiStore.getState().focusPrompt()
    expect(useUiStore.getState().promptFocusNonce).toBe(2)
  })

  it('setGenerationError pone y limpia el mensaje', () => {
    useUiStore.getState().setGenerationError('fallo de generación')
    expect(useUiStore.getState().generationError).toBe('fallo de generación')
    useUiStore.getState().setGenerationError(null)
    expect(useUiStore.getState().generationError).toBeNull()
  })
})
