import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { VersionMeta } from '../types'

// Tests de useHistoryNav (restaurar una versión del diario). Mockeamos el store,
// el cliente REST (getVersion) y el toast.
const h = vi.hoisted(() => ({
  diagramId: 'diag-1' as string | null,
  getVersion: vi.fn(),
  goToVersion: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

vi.mock('../store/index', () => ({
  useStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({ currentDiagramId: h.diagramId }),
    { getState: () => ({ goToVersion: h.goToVersion }) },
  ),
}))
vi.mock('../lib/api', () => ({ getVersion: h.getVersion }))
vi.mock('../store/toast', () => ({ toast: h.toast }))

import { useHistoryNav } from '../hooks/useHistoryNav'

const fakeVersion: VersionMeta = { id: 'v1' } as VersionMeta

beforeEach(() => {
  vi.clearAllMocks()
  h.diagramId = 'diag-1'
})

describe('useHistoryNav — restoreVersion', () => {
  it('pide la versión al backend y la aplica con goToVersion', async () => {
    const rowData = { nodes: [], edges: [] }
    h.getVersion.mockResolvedValueOnce({ data: rowData })

    const { result } = renderHook(() => useHistoryNav())
    await result.current.restoreVersion(fakeVersion)

    expect(h.getVersion).toHaveBeenCalledWith('diag-1', 'v1')
    expect(h.goToVersion).toHaveBeenCalledWith(fakeVersion, rowData)
    expect(h.toast.error).not.toHaveBeenCalled()
  })

  it('no hace nada si no hay diagrama activo (currentDiagramId null)', async () => {
    h.diagramId = null
    const { result } = renderHook(() => useHistoryNav())
    await result.current.restoreVersion(fakeVersion)

    expect(h.getVersion).not.toHaveBeenCalled()
    expect(h.goToVersion).not.toHaveBeenCalled()
  })

  it('avisa con toast si getVersion falla y no aplica la versión', async () => {
    h.getVersion.mockRejectedValueOnce(new Error('404'))
    const { result } = renderHook(() => useHistoryNav())
    await result.current.restoreVersion(fakeVersion)

    expect(h.goToVersion).not.toHaveBeenCalled()
    expect(h.toast.error).toHaveBeenCalledWith('No se pudo abrir esa versión.')
  })
})
