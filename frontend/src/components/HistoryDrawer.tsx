import { useState, useEffect } from 'react'
import { Drawer, Badge } from '../ui/primitives'
import { useUiStore } from '../store/ui'
import { useAuthStore } from '../store/auth'
import { listDiagrams, getDiagram } from '../lib/api'
import type { DiagramMeta } from '../lib/api'
import { useStore } from '../store/index'
import { useHistoryStore } from '../store/history'

const BADGE_COLORS: Record<string, string> = {
  erd: 'var(--color-accent)',
  uml_class: 'var(--color-accent-2)',
  sequence: 'var(--color-accent-3)',
  flowchart: '#a855f7',
  architecture: 'var(--color-warn)',
  state_machine: '#ec4899',
  mindmap: '#06b6d4',
}

export function HistoryDrawer() {
  const { drawerOpen, setDrawerOpen } = useUiStore()
  const user = useAuthStore((s) => s.user)
  const { setCurrentDiagram, setCurrentDiagramId, setLastGenerationPrompt, setUiState, setMessages } = useStore()
  const [items, setItems] = useState<DiagramMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!drawerOpen || !user) return
    Promise.resolve()
      .then(() => {
        setLoading(true)
        setError(null)
        return listDiagrams()
      })
      .then(setItems)
      .catch((e: Error) => setError(e.message ?? 'Error'))
      .finally(() => setLoading(false))
  }, [drawerOpen, user])

  const filtered = items.filter((item) =>
    item.title.toLowerCase().includes(search.toLowerCase()),
  )

  async function loadDiagram(id: string) {
    try {
      const row = await getDiagram(id)
      setCurrentDiagram(row.data)
      setCurrentDiagramId(row.id)
      setLastGenerationPrompt(row.prompt ?? null)
      // Restaura la conversación del diagrama. El timestamp viaja como string ISO
      // (jsonb): se revive a Date porque ChatMessage llama a toLocaleTimeString.
      setMessages(
        (row.messages ?? []).map((m) => ({ ...m, timestamp: new Date(m.timestamp) })),
      )
      useHistoryStore.getState().reset()
      setUiState('ready')
      setDrawerOpen(false)
    } catch (e) {
      console.error('[HistoryDrawer] error cargando diagrama:', e)
    }
  }

  return (
    <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 py-3 border-b-[3px] border-[var(--color-ink)]">
          <span className="font-bold text-lg text-[var(--color-ink)]">Historial</span>
          <button
            onClick={() => setDrawerOpen(false)}
            className="text-[var(--color-ink)] hover:text-[var(--color-accent)] text-xl leading-none"
          >
            ×
          </button>
        </div>
        {!user ? (
          <p className="text-center text-sm text-[var(--color-ink)]/50 py-8 px-4">
            Inicia sesión con Google para ver tu historial de diagramas.
          </p>
        ) : (
          <>
            <input
              type="search"
              placeholder="Buscar por título..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mx-4 mt-3 mb-2 block border-[3px] border-[var(--color-ink)] p-2 text-sm bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] text-[var(--color-ink)]"
            />
            <div className="flex-1 overflow-y-auto">
              {loading && (
                <p className="text-center text-sm text-[var(--color-ink)]/50 py-8">Cargando...</p>
              )}
              {error && (
                <p className="text-center text-sm text-[var(--color-danger)] py-8">{error}</p>
              )}
              {!loading && !error && filtered.length === 0 && (
                <p className="text-center text-sm text-[var(--color-ink)]/50 py-8">
                  Sin diagramas guardados
                </p>
              )}
              {!loading &&
                !error &&
                filtered.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => loadDiagram(item.id)}
                    className="w-full text-left px-4 py-3 border-b border-[var(--color-ink)]/20 hover:bg-[var(--color-accent)]/10 active:bg-[var(--color-accent)]/20"
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-[var(--color-ink)] break-words">
                          {item.title}
                        </span>
                        <span className="mt-1 block text-xs text-[var(--color-ink)]/50">
                          {new Date(item.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <Badge
                        color={BADGE_COLORS[item.diagram_type] ?? 'var(--color-accent)'}
                        className="shrink-0 text-white"
                      >
                        {item.diagram_type}
                      </Badge>
                    </div>
                  </button>
                ))}
            </div>
          </>
        )}
      </div>
    </Drawer>
  )
}
