import { useState, useEffect } from 'react'
import { Drawer, Badge } from '../ui/primitives'
import { useUiStore } from '../store/ui'
import { useAuthStore } from '../store/auth'
import {
  listDiagrams,
  getDiagram,
  deleteDiagram,
  listTrash,
  restoreDiagram,
  deleteDiagramPermanent,
  emptyTrash,
} from '../lib/api'
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

// El menú contextual sirve tanto a las tarjetas del historial ('active': Eliminar)
// como a las de la papelera ('trash': Restaurar / Borrar definitivamente).
type Menu = { id: string; x: number; y: number; kind: 'active' | 'trash' }

export function HistoryDrawer() {
  const { drawerOpen, setDrawerOpen } = useUiStore()
  const user = useAuthStore((s) => s.user)
  const { setCurrentDiagram, setCurrentDiagramId, setLastGenerationPrompt, setUiState, setMessages } = useStore()
  const markCurrentTrashed = useStore((s) => s.markCurrentTrashed)
  const newDiagram = useStore((s) => s.newDiagram)
  const currentDiagramId = useStore((s) => s.currentDiagramId)

  const [items, setItems] = useState<DiagramMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Papelera: segundo panel que se despliega a la derecha del historial.
  const [trashOpen, setTrashOpen] = useState(false)
  const [trashItems, setTrashItems] = useState<DiagramMeta[]>([])
  const [trashLoading, setTrashLoading] = useState(false)
  const [trashError, setTrashError] = useState<string | null>(null)
  const [trashSearch, setTrashSearch] = useState('')

  // Menú contextual (clic derecho). null = cerrado.
  const [menu, setMenu] = useState<Menu | null>(null)

  // Cualquier clic/scroll/Escape fuera del menú lo cierra.
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', close)
    }
  }, [menu])

  // Cerrar el historial cierra también la papelera.
  useEffect(() => {
    if (!drawerOpen) setTrashOpen(false)
  }, [drawerOpen])

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

  useEffect(() => {
    if (!trashOpen || !user) return
    setTrashLoading(true)
    setTrashError(null)
    listTrash()
      .then(setTrashItems)
      .catch((e: Error) => setTrashError(e.message ?? 'Error'))
      .finally(() => setTrashLoading(false))
  }, [trashOpen, user])

  const filtered = items.filter((item) =>
    item.title.toLowerCase().includes(search.toLowerCase()),
  )
  const filteredTrash = trashItems.filter((item) =>
    item.title.toLowerCase().includes(trashSearch.toLowerCase()),
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

  // Borrado suave: el diagrama sale del historial y entra en la papelera. Se hace
  // optimista (mueve la tarjeta al instante) y se revierte si la petición falla.
  async function handleDelete(id: string) {
    setMenu(null)
    const prev = items
    const victim = items.find((it) => it.id === id)
    setItems((list) => list.filter((it) => it.id !== id))
    try {
      await deleteDiagram(id)
      // Si borramos el diagrama ABIERTO, lo quitamos del canvas y dejamos el aviso
      // "en la papelera, clica para restaurar" (markCurrentTrashed además limpia el
      // id cacheado, así que un guardado posterior sería un INSERT, no un PATCH a
      // una fila ya borrada).
      if (currentDiagramId === id) {
        markCurrentTrashed({ id, title: victim?.title ?? 'Diagrama' })
      }
      if (victim) {
        setTrashItems((list) => [
          { ...victim, deleted_at: new Date().toISOString() },
          ...list,
        ])
      }
    } catch (e) {
      console.error('[HistoryDrawer] error eliminando diagrama:', e)
      setItems(prev)
    }
  }

  async function handleRestore(id: string) {
    setMenu(null)
    const prev = trashItems
    const victim = trashItems.find((it) => it.id === id)
    setTrashItems((list) => list.filter((it) => it.id !== id))
    try {
      await restoreDiagram(id)
      // Si el restaurado es el que estaba en el limbo "en la papelera", lo cargamos
      // de vuelta al canvas (loadDiagram limpia el aviso vía setCurrentDiagram).
      if (useStore.getState().trashedDiagram?.id === id) {
        await loadDiagram(id)
      } else if (victim) {
        setItems((list) => [{ ...victim, deleted_at: null }, ...list])
      }
    } catch (e) {
      console.error('[HistoryDrawer] error restaurando diagrama:', e)
      setTrashItems(prev)
    }
  }

  async function handlePermanentDelete(id: string) {
    setMenu(null)
    const prev = trashItems
    setTrashItems((list) => list.filter((it) => it.id !== id))
    try {
      await deleteDiagramPermanent(id)
      // Si el borrado en firme es el que estaba en el limbo, se acabó la opción de
      // restaurar: arrancamos un diagrama nuevo en blanco.
      if (useStore.getState().trashedDiagram?.id === id) newDiagram()
    } catch (e) {
      console.error('[HistoryDrawer] error borrando definitivamente:', e)
      setTrashItems(prev)
    }
  }

  async function handleEmptyTrash() {
    if (trashItems.length === 0) return
    const prev = trashItems
    setTrashItems([])
    try {
      await emptyTrash()
      // El diagrama en el limbo vivía en la papelera: al vaciarla desaparece, así
      // que no hay nada que restaurar → diagrama nuevo en blanco.
      if (useStore.getState().trashedDiagram) newDiagram()
    } catch (e) {
      console.error('[HistoryDrawer] error vaciando papelera:', e)
      setTrashItems(prev)
    }
  }

  return (
    <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 py-3 border-b-[3px] border-[var(--color-ink)]">
          <div className="flex items-center gap-2 min-w-0">
            {trashOpen && (
              <button
                onClick={() => setTrashOpen(false)}
                aria-label="Volver al historial"
                className="text-[var(--color-ink)] hover:text-[var(--color-accent)] text-xl leading-none"
              >
                ←
              </button>
            )}
            <span className="font-bold text-lg text-[var(--color-ink)] truncate">
              {trashOpen ? 'Papelera' : 'Historial'}
            </span>
          </div>
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
        ) : trashOpen ? (
          <>
            <div className="px-4 py-3 border-b-[3px] border-[var(--color-ink)]">
              <input
                type="search"
                placeholder="Buscar por título..."
                value={trashSearch}
                onChange={(e) => setTrashSearch(e.target.value)}
                className="block w-full border-[3px] border-[var(--color-ink)] p-2 text-sm bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] text-[var(--color-ink)]"
              />
              <button
                onClick={handleEmptyTrash}
                disabled={trashItems.length === 0}
                className="mt-3 block w-full border-[3px] border-[var(--color-ink)] p-2 text-sm font-semibold text-[var(--color-danger)] bg-[var(--color-bg)] hover:bg-[var(--color-danger)]/10 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Vaciar papelera
              </button>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-brutal">
              {trashLoading && (
                <p className="text-center text-sm text-[var(--color-ink)]/50 py-8">Cargando...</p>
              )}
              {trashError && (
                <p className="text-center text-sm text-[var(--color-danger)] py-8">{trashError}</p>
              )}
              {!trashLoading && !trashError && filteredTrash.length === 0 && (
                <p className="text-center text-sm text-[var(--color-ink)]/50 py-8">
                  Papelera vacía
                </p>
              )}
              {!trashLoading &&
                !trashError &&
                filteredTrash.map((item) => (
                  <div
                    key={item.id}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setMenu({ id: item.id, x: e.clientX, y: e.clientY, kind: 'trash' })
                    }}
                    className="px-4 py-3 border-b border-[var(--color-ink)]/20 hover:bg-[var(--color-accent)]/10"
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-[var(--color-ink)] break-words">
                          {item.title}
                        </span>
                        <span className="mt-1 block text-xs text-[var(--color-ink)]/50">
                          {item.deleted_at && new Date(item.deleted_at).toLocaleDateString()}
                        </span>
                      </div>
                      <Badge
                        color={BADGE_COLORS[item.diagram_type] ?? 'var(--color-accent)'}
                        className="shrink-0 text-white"
                      >
                        {item.diagram_type}
                      </Badge>
                    </div>
                  </div>
                ))}
            </div>
          </>
        ) : (
          <>
            <div className="px-4 py-3 border-b-[3px] border-[var(--color-ink)]">
              <input
                type="search"
                placeholder="Buscar por título..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="block w-full border-[3px] border-[var(--color-ink)] p-2 text-sm bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] text-[var(--color-ink)]"
              />
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-brutal">
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
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setMenu({ id: item.id, x: e.clientX, y: e.clientY, kind: 'active' })
                    }}
                    className="w-full text-left px-4 py-3 border-b border-[var(--color-ink)]/20 hover:bg-[var(--color-accent)]/10 active:bg-[var(--color-accent)]/20"
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-[var(--color-ink)] break-words">
                          {item.title}
                        </span>
                        <span className="mt-1 block text-xs text-[var(--color-ink)]/50">
                          {new Date(item.updated_at).toLocaleDateString()}
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
            {/* Pie: acceso a la papelera */}
            <button
              onClick={() => setTrashOpen(true)}
              className="flex items-center justify-center gap-2 px-4 py-3 border-t-[3px] border-[var(--color-ink)] text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-accent)]/10"
            >
              Papelera
            </button>
          </>
        )}
      </div>

      {menu && (
        <div
          className="fixed z-50 border-[3px] border-[var(--color-ink)] bg-[var(--color-bg)] shadow-[4px_4px_0_var(--color-ink)]"
          style={{ top: menu.y, left: menu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.kind === 'active' ? (
            <button
              onClick={() => handleDelete(menu.id)}
              className="block w-full px-4 py-2 text-left text-sm font-semibold text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
            >
              Eliminar
            </button>
          ) : (
            <>
              <button
                onClick={() => handleRestore(menu.id)}
                className="block w-full px-4 py-2 text-left text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-accent)]/10"
              >
                Restaurar
              </button>
              <button
                onClick={() => handlePermanentDelete(menu.id)}
                className="block w-full px-4 py-2 text-left text-sm font-semibold text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
              >
                Borrar definitivamente
              </button>
            </>
          )}
        </div>
      )}
    </Drawer>
  )
}
