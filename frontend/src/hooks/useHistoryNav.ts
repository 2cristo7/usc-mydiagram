import { useStore } from '../store/index'
import { getVersion } from '../lib/api'
import { toast } from '../store/toast'
import type { VersionMeta } from '../types'

// S10.3 — "Volver a esta versión". El diario es un ÁRBOL append-only: navegar a una
// versión NO crea nada ni pierde progreso — solo mueve la posición del árbol y pone
// el canvas en su snapshot. La tarjeta destino pasa a ser la actual (su botón se
// desactiva). Si después editas o generas, la nueva versión se cuelga de AHÍ (rama
// nueva); las versiones que quedan fuera del camino vivo son ramas muertas (siguen
// en el diario, se muestran arriba).
export function useHistoryNav() {
  const diagramId = useStore((s) => s.currentDiagramId)

  async function restoreVersion(v: VersionMeta) {
    if (!diagramId) return
    try {
      const row = await getVersion(diagramId, v.id)
      useStore.getState().goToVersion(v, row.data)
    } catch {
      toast.error('No se pudo abrir esa versión.')
    }
  }

  return { restoreVersion }
}
