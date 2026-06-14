import { describe, it, expect, beforeEach } from 'vitest'
import { useUiStore } from '../store/ui'

beforeEach(() => {
  useUiStore.setState({ drawerOpen: false, toolTrayExpanded: false })
})

describe('ui store', () => {
  it('drawerOpen toggles', () => {
    const { toggleDrawer } = useUiStore.getState()
    expect(useUiStore.getState().drawerOpen).toBe(false)
    toggleDrawer()
    expect(useUiStore.getState().drawerOpen).toBe(true)
    toggleDrawer()
    expect(useUiStore.getState().drawerOpen).toBe(false)
  })

  it('setDrawerOpen sets value', () => {
    const { setDrawerOpen } = useUiStore.getState()
    setDrawerOpen(true)
    expect(useUiStore.getState().drawerOpen).toBe(true)
    setDrawerOpen(false)
    expect(useUiStore.getState().drawerOpen).toBe(false)
  })

  it('toolTrayExpanded set', () => {
    const { setToolTrayExpanded } = useUiStore.getState()
    setToolTrayExpanded(true)
    expect(useUiStore.getState().toolTrayExpanded).toBe(true)
  })
})
