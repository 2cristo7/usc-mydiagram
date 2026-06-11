import { useState } from 'react'
import { useStore } from '../store/index'
import { useAuthStore } from '../store/auth'
import { listDiagrams, getDiagram, type DiagramMeta } from '../lib/api'

// S9.3 — Panel de historial: lista la metadata de los diagramas del usuario
// (P5) y, al pulsar uno, trae su `data` completo y lo carga al canvas, fijando
// el currentDiagramId para que las ediciones siguientes hagan PATCH (no un
// segundo POST). Solo visible con sesión: sin login no hay nada que listar.
export function HistoryPanel() {
  const user = useAuthStore((s) => s.user)
  const setCurrentDiagram = useStore((s) => s.setCurrentDiagram)
  const setCurrentDiagramId = useStore((s) => s.setCurrentDiagramId)
  const setLastGenerationPrompt = useStore((s) => s.setLastGenerationPrompt)
  const setUiState = useStore((s) => s.setUiState)

  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<DiagramMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!user) return null

  async function toggle() {
    const next = !open
    setOpen(next)
    if (!next) return
    setLoading(true)
    setError(null)
    try {
      setItems(await listDiagrams())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function load(id: string) {
    try {
      const row = await getDiagram(id)
      setCurrentDiagram(row.data)
      setCurrentDiagramId(row.id)
      // S9.3b — restaura el prompt de origen para poder regenerar (si se guardó).
      setLastGenerationPrompt(row.prompt ?? null)
      setUiState('ready')
      setOpen(false)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={toggle}
        className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Historial
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 max-h-80 w-72 overflow-auto rounded border border-gray-200 bg-white shadow-lg">
          {loading && <p className="px-3 py-2 text-sm text-gray-500">Cargando…</p>}
          {error && <p className="px-3 py-2 text-sm text-red-600">{error}</p>}
          {!loading && !error && items.length === 0 && (
            <p className="px-3 py-2 text-sm text-gray-500">No tienes diagramas guardados.</p>
          )}
          {items.map((d) => (
            <button
              key={d.id}
              onClick={() => load(d.id)}
              className="flex w-full flex-col items-start border-b border-gray-100 px-3 py-2 text-left hover:bg-gray-50 last:border-b-0"
            >
              <span className="truncate text-sm font-medium text-gray-800">{d.title}</span>
              <span className="text-xs text-gray-400">
                {d.diagram_type} · {new Date(d.updated_at).toLocaleString()}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
