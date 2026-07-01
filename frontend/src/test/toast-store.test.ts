import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { useToastStore, toast } from '../store/toast'

beforeEach(() => {
  // clear() purga timers internos y vacía la lista.
  useToastStore.getState().clear()
  vi.useRealTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('toast store', () => {
  it('push añade un toast y devuelve un id', () => {
    const id = useToastStore.getState().push('info', 'Hola')
    expect(id).not.toBe('')
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatchObject({ id, variant: 'info', message: 'Hola' })
  })

  it('push deduplica toasts idénticos (misma variante + mensaje) devolviendo cadena vacía', () => {
    const id1 = useToastStore.getState().push('error', 'fallo')
    const id2 = useToastStore.getState().push('error', 'fallo')
    expect(id1).not.toBe('')
    expect(id2).toBe('')
    expect(useToastStore.getState().toasts).toHaveLength(1)
  })

  it('push permite mensajes iguales con variantes distintas', () => {
    useToastStore.getState().push('error', 'igual')
    useToastStore.getState().push('success', 'igual')
    expect(useToastStore.getState().toasts).toHaveLength(2)
  })

  it('push guarda la acción opcional', () => {
    const onClick = vi.fn()
    useToastStore.getState().push('warning', 'con accion', { action: { label: 'Reintentar', onClick } })
    expect(useToastStore.getState().toasts[0].action).toEqual({ label: 'Reintentar', onClick })
  })

  it('autodescarta tras la duración por defecto de la variante', () => {
    vi.useFakeTimers()
    useToastStore.getState().push('success', 'efimero') // 4000 ms
    expect(useToastStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(3999)
    expect(useToastStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('duration:0 hace el toast persistente (no autodescarta)', () => {
    vi.useFakeTimers()
    useToastStore.getState().push('error', 'persistente', { duration: 0 })
    vi.advanceTimersByTime(60_000)
    expect(useToastStore.getState().toasts).toHaveLength(1)
  })

  it('duration personalizada gana a la de la variante', () => {
    vi.useFakeTimers()
    useToastStore.getState().push('error', 'rapido', { duration: 100 })
    vi.advanceTimersByTime(100)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('dismiss elimina por id y limpia su timer', () => {
    vi.useFakeTimers()
    const id = useToastStore.getState().push('info', 'a')
    useToastStore.getState().push('info', 'b')
    useToastStore.getState().dismiss(id)
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toBe('b')
    // El timer del descartado ya no debe disparar nada inesperado.
    vi.advanceTimersByTime(10_000)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('dismiss de un id inexistente es no-op', () => {
    useToastStore.getState().push('info', 'a')
    useToastStore.getState().dismiss('no-existe')
    expect(useToastStore.getState().toasts).toHaveLength(1)
  })

  it('clear vacía todos los toasts y sus timers', () => {
    vi.useFakeTimers()
    useToastStore.getState().push('info', 'a')
    useToastStore.getState().push('success', 'b')
    useToastStore.getState().clear()
    expect(useToastStore.getState().toasts).toHaveLength(0)
    vi.advanceTimersByTime(10_000)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('helper toast.* delega en el store con la variante correcta', () => {
    toast.error('e')
    toast.success('s')
    toast.info('i')
    toast.warning('w')
    const variants = useToastStore.getState().toasts.map((t) => t.variant)
    expect(variants).toEqual(['error', 'success', 'info', 'warning'])
  })

  it('helper toast.dismiss elimina el toast cuyo id devuelve un push previo', () => {
    const id = toast.info('quitame')
    toast.dismiss(id)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})
