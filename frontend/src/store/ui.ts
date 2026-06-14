import { create } from 'zustand'

interface UiStore {
  drawerOpen: boolean
  setDrawerOpen: (open: boolean) => void
  toggleDrawer: () => void
  toolTrayExpanded: boolean
  setToolTrayExpanded: (v: boolean) => void
  nodePaletteOpen: boolean
  setNodePaletteOpen: (open: boolean) => void
  toggleNodePalette: () => void
}

export const useUiStore = create<UiStore>((set) => ({
  drawerOpen: false,
  setDrawerOpen: (open) => set({ drawerOpen: open }),
  toggleDrawer: () => set((s) => ({ drawerOpen: !s.drawerOpen })),
  toolTrayExpanded: false,
  setToolTrayExpanded: (v) => set({ toolTrayExpanded: v }),
  nodePaletteOpen: false,
  setNodePaletteOpen: (open) => set({ nodePaletteOpen: open }),
  toggleNodePalette: () => set((s) => ({ nodePaletteOpen: !s.nodePaletteOpen })),
}))
