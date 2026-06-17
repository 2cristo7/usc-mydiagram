import { create } from 'zustand'

// Tamaño (en px de flujo) de la CAJA DE TEXTO de cada nodo archIcon, publicado
// por ArchIconNode al medirla. Vive fuera del diagrama (no se persiste): es
// geometría derivada del render que necesitan las utils de aristas para
// reconstruir la silueta "botella" del nodo (icono 72×72 + texto debajo) y
// anclar los extremos sobre ella. Ver `ui/utils/archBottle.ts`.
type Size = { w: number; h: number }

type ArchGeomState = {
  sizes: Map<string, Size>
  // Se incrementa en cada cambio real de tamaño: las aristas se suscriben a él
  // para recomputar su trazado cuando un nodo conoce/actualiza su caja de texto.
  version: number
  setSize: (id: string, w: number, h: number) => void
  removeSize: (id: string) => void
}

export const useArchGeom = create<ArchGeomState>((set, get) => ({
  sizes: new Map(),
  version: 0,
  setSize: (id, w, h) => {
    const cur = get().sizes.get(id)
    if (cur && cur.w === w && cur.h === h) return
    const sizes = new Map(get().sizes)
    sizes.set(id, { w, h })
    set({ sizes, version: get().version + 1 })
  },
  removeSize: (id) => {
    if (!get().sizes.has(id)) return
    const sizes = new Map(get().sizes)
    sizes.delete(id)
    set({ sizes, version: get().version + 1 })
  },
}))

// Lectura no reactiva (para utils puras): tamaño del texto de un nodo, o {0,0}
// si aún no se ha medido (en ese caso la botella degenera en solo el icono).
export function getArchTextSize(id: string): Size {
  return useArchGeom.getState().sizes.get(id) ?? { w: 0, h: 0 }
}
