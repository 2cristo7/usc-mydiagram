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
  // S10.x — bloqueo del lienzo (equivale al candado de <Controls> de React Flow):
  // cuando está activo, los nodos no se arrastran/seleccionan/conectan. Vive aquí
  // porque el botón (EditToolbar) y el consumidor (DiagramCanvas) están en celdas
  // distintas del grid.
  canvasLocked: boolean
  toggleCanvasLock: () => void
  // S10.x — grid de snapping. Cuando está activo, el fondo muestra una rejilla y
  // tanto los nodos (snapGrid de React Flow) como los waypoints de las aristas se
  // fijan a las celdas del grid al arrastrarlos. Al desactivarlo, movimiento libre.
  gridEnabled: boolean
  toggleGrid: () => void
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
  canvasLocked: false,
  toggleCanvasLock: () => set((s) => ({ canvasLocked: !s.canvasLocked })),
  gridEnabled: false,
  toggleGrid: () => set((s) => ({ gridEnabled: !s.gridEnabled })),
}))
