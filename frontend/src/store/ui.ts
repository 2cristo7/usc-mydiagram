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
  // Contador que se incrementa para pedir foco en el prompt flotante (lo usa el
  // CTA del estado vacío del canvas). FloatingPrompt observa el cambio y enfoca
  // su textarea. Un nonce en vez de un booleano para poder reenfocar repetido.
  promptFocusNonce: number
  focusPrompt: () => void
  // Mensaje de error de la última generación/refinamiento fallido. Se muestra como
  // un AlertBanner anclado al borde superior del canvas (no como tarjeta central ni
  // toast efímero). null = sin error visible. Lo gobierna useWebSocket: lo pone con
  // el detalle del fallo (diagram:error, timeout, snapshot inválido) y a null en los
  // fallos de infraestructura (conexión/auth, que conservan su propio toast) y al
  // descartarlo. El render se condiciona además a uiState==='error', así que un valor
  // residual queda inerte mientras no haya un error activo.
  generationError: string | null
  setGenerationError: (message: string | null) => void
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
  promptFocusNonce: 0,
  focusPrompt: () => set((s) => ({ promptFocusNonce: s.promptFocusNonce + 1 })),
  generationError: null,
  setGenerationError: (message) => set({ generationError: message }),
}))
