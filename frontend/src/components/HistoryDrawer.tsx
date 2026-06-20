import { useState, useEffect, useRef } from 'react'
import { LogIn, SearchX, Inbox, Trash2, Plus } from 'lucide-react'
import { Drawer, Badge, Spinner, EmptyState } from '../ui/primitives'
import { useUiStore } from '../store/ui'
import { useAuthStore } from '../store/auth'
import {
  listDiagrams,
  getDiagram,
  listVersions,
  deleteDiagram,
  renameDiagram,
  listTrash,
  restoreDiagram,
  deleteDiagramPermanent,
  emptyTrash,
} from '../lib/api'
import type { DiagramMeta } from '../lib/api'
import { useStore } from '../store/index'
import { useHistoryStore } from '../store/history'
import { DIAGRAM_TYPE_OPTIONS } from '../types'
import { toast } from '../store/toast'

// Etiquetas en español, reutilizando el mismo origen que las tarjetas de
// selección de tipo de diagrama. Si el tipo no está mapeado, se muestra crudo.
const TYPE_LABELS: Record<string, string> = Object.fromEntries(
  DIAGRAM_TYPE_OPTIONS.map((o) => [o.value, o.label]),
)

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
  const { setCurrentDiagram, setCurrentDiagramId, setLastGenerationPrompt, setUiState, setVersions } = useStore()
  const markCurrentTrashed = useStore((s) => s.markCurrentTrashed)
  const newDiagram = useStore((s) => s.newDiagram)
  const currentDiagramId = useStore((s) => s.currentDiagramId)
  const setCurrentTitle = useStore((s) => s.setCurrentTitle)

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

  // Renombrado inline desde el historial. renamingId = tarjeta en edición (null =
  // ninguna); renameValue es el borrador del nuevo título.
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  // Cerrar el input (Enter/Escape) lo desmonta y dispara su `blur`, que reentraría
  // en finishRename. El flag garantiza que cada edición se resuelve una sola vez
  // (y que un Escape no acabe confirmando vía el blur posterior).
  const renameFinishedRef = useRef(false)

  // id del diagrama cuya carga está en curso (clic en una tarjeta): muestra
  // spinner en esa tarjeta y bloquea más clics mientras llega del servidor.
  const [loadingId, setLoadingId] = useState<string | null>(null)
  // Vaciado de papelera en curso: bloquea el botón para no repetir la petición.
  const [emptyingTrash, setEmptyingTrash] = useState(false)

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

  // Arranca un diagrama nuevo en blanco desde el historial: limpia el workspace
  // vivo (canvas + chat), resetea el diario undo/redo y cierra el cajón para dejar
  // el lienzo a la vista. No toca la BD; el próximo prompt genera desde cero.
  function handleNewDiagram() {
    newDiagram()
    useHistoryStore.getState().reset()
    setDrawerOpen(false)
  }

  async function loadDiagram(id: string) {
    if (loadingId) return
    setLoadingId(id)
    try {
      const row = await getDiagram(id)
      setCurrentDiagram(row.data)
      setCurrentDiagramId(row.id)
      setLastGenerationPrompt(row.prompt ?? null)
      // Restaura el diario de versiones del diagrama: puebla la lista de
      // operaciones y habilita la navegación ◀ ▶. Si falla, el diagrama abre
      // igual con el diario vacío (degrada, no rompe).
      try {
        setVersions(await listVersions(id))
      } catch {
        setVersions([])
      }
      useHistoryStore.getState().reset()
      setUiState('ready')
      setDrawerOpen(false)
    } catch (e) {
      console.error('[HistoryDrawer] error cargando diagrama:', e)
      toast.error('No se pudo abrir el diagrama.')
    } finally {
      setLoadingId(null)
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
      // La tarjeta reaparece por el rollback optimista; el toast explica al usuario
      // por qué volvió (sin él, la UI parece errática).
      toast.error('No se pudo eliminar el diagrama.')
      setItems(prev)
    }
  }

  // Arranca la edición inline de un título desde el menú contextual.
  function startRename(id: string) {
    const item = items.find((it) => it.id === id)
    setMenu(null)
    renameFinishedRef.current = false
    setRenameValue(item?.title ?? '')
    setRenamingId(id)
  }

  // Cierra la edición. Con commit=true confirma el renombrado: optimista (cambia
  // la tarjeta al instante y, si es el diagrama abierto, también el header) y se
  // revierte si la petición falla. Con commit=false (Escape) solo cancela.
  async function finishRename(id: string, commit: boolean) {
    if (renameFinishedRef.current) return
    renameFinishedRef.current = true
    const next = renameValue.trim()
    const original = items.find((it) => it.id === id)?.title
    setRenamingId(null)
    if (!commit || !next || next === original) return
    setItems((list) => list.map((it) => (it.id === id ? { ...it, title: next } : it)))
    if (currentDiagramId === id) setCurrentTitle(next)
    try {
      await renameDiagram(id, next)
    } catch (e) {
      console.error('[HistoryDrawer] error renombrando diagrama:', e)
      toast.error('No se pudo renombrar el diagrama.')
      setItems((list) =>
        list.map((it) => (it.id === id ? { ...it, title: original ?? it.title } : it)),
      )
      if (currentDiagramId === id && original) setCurrentTitle(original)
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
      toast.error('No se pudo restaurar el diagrama.')
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
      toast.error('No se pudo borrar definitivamente.')
      setTrashItems(prev)
    }
  }

  async function handleEmptyTrash() {
    if (trashItems.length === 0 || emptyingTrash) return
    setEmptyingTrash(true)
    const prev = trashItems
    setTrashItems([])
    try {
      await emptyTrash()
      // El diagrama en el limbo vivía en la papelera: al vaciarla desaparece, así
      // que no hay nada que restaurar → diagrama nuevo en blanco.
      if (useStore.getState().trashedDiagram) newDiagram()
    } catch (e) {
      console.error('[HistoryDrawer] error vaciando papelera:', e)
      toast.error('No se pudo vaciar la papelera.')
      setTrashItems(prev)
    } finally {
      setEmptyingTrash(false)
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
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon={<LogIn size={40} />}
              title="Inicia sesión para ver tu historial"
              description="Con tu cuenta de Google guardamos automáticamente cada diagrama que generes y podrás recuperarlo desde aquí."
            />
          </div>
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
                disabled={trashItems.length === 0 || emptyingTrash}
                className="mt-3 flex w-full items-center justify-center gap-2 border-[3px] border-[var(--color-ink)] p-2 text-sm font-semibold text-[var(--color-danger)] bg-[var(--color-bg)] hover:bg-[var(--color-danger)]/10 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {emptyingTrash && <Spinner size={14} label="Vaciando papelera" />}
                {emptyingTrash ? 'Vaciando…' : 'Vaciar papelera'}
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
                trashSearch.trim() ? (
                  <EmptyState
                    className="py-10"
                    icon={<SearchX size={36} />}
                    title="Sin coincidencias"
                    description={`Ningún diagrama de la papelera coincide con «${trashSearch.trim()}».`}
                  />
                ) : (
                  <EmptyState
                    className="py-10"
                    icon={<Trash2 size={36} />}
                    title="Papelera vacía"
                    description="Los diagramas que elimines aparecerán aquí y podrás restaurarlos."
                  />
                )
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
                        {TYPE_LABELS[item.diagram_type] ?? item.diagram_type}
                      </Badge>
                    </div>
                  </div>
                ))}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-stretch gap-2 px-4 py-3 border-b-[3px] border-[var(--color-ink)]">
              <input
                type="search"
                placeholder="Buscar por título..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="block min-w-0 flex-1 border-[3px] border-[var(--color-ink)] p-2 text-sm bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] text-[var(--color-ink)]"
              />
              <button
                onClick={handleNewDiagram}
                aria-label="Nuevo diagrama"
                title="Nuevo diagrama"
                className="flex aspect-square shrink-0 items-center justify-center border-[3px] border-[var(--color-ink)] text-[var(--color-ink)] bg-[var(--color-accent)] hover:brightness-95 active:translate-y-px"
              >
                <Plus size={18} strokeWidth={3} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-brutal">
              {loading && (
                <p className="text-center text-sm text-[var(--color-ink)]/50 py-8">Cargando...</p>
              )}
              {error && (
                <p className="text-center text-sm text-[var(--color-danger)] py-8">{error}</p>
              )}
              {!loading && !error && filtered.length === 0 && (
                search.trim() ? (
                  <EmptyState
                    className="py-10"
                    icon={<SearchX size={36} />}
                    title="Sin coincidencias"
                    description={`Ningún diagrama coincide con «${search.trim()}».`}
                  />
                ) : (
                  <EmptyState
                    className="py-10"
                    icon={<Inbox size={36} />}
                    title="Aún no has guardado diagramas"
                    description="Genera tu primer diagrama desde el chat: se guardará aquí automáticamente."
                  />
                )
              )}
              {!loading &&
                !error &&
                filtered.map((item) =>
                  renamingId === item.id ? (
                    // En edición la tarjeta deja de ser un botón: así clicar el input
                    // no abre el diagrama. Enter/blur confirma, Escape cancela.
                    <div
                      key={item.id}
                      className="px-4 py-3 border-b border-[var(--color-ink)]/20"
                    >
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <textarea
                            // El nombre puede ser largo: textarea para que envuelva
                            // a varias líneas (como la tarjeta). El ref autoajusta la
                            // altura al contenido en cada render (mount + tecleo).
                            ref={(el) => {
                              if (!el) return
                              el.style.height = 'auto'
                              el.style.height = `${el.scrollHeight}px`
                            }}
                            autoFocus
                            rows={1}
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onFocus={(e) => e.target.select()}
                            onBlur={() => finishRename(item.id, true)}
                            onKeyDown={(e) => {
                              // Enter confirma (el título es una sola cadena, sin
                              // saltos de línea); Escape cancela.
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                finishRename(item.id, true)
                              } else if (e.key === 'Escape') {
                                e.preventDefault()
                                finishRename(item.id, false)
                              }
                            }}
                            placeholder="Nombre del diagrama"
                            className="block w-full resize-none overflow-hidden border-[3px] border-[var(--color-ink)] bg-[var(--color-bg)] px-1.5 py-0.5 text-sm font-semibold leading-snug text-[var(--color-ink)] break-words focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                          />
                        </div>
                        <Badge
                          color={BADGE_COLORS[item.diagram_type] ?? 'var(--color-accent)'}
                          className="shrink-0 text-white"
                        >
                          {TYPE_LABELS[item.diagram_type] ?? item.diagram_type}
                        </Badge>
                      </div>
                    </div>
                  ) : (
                    <button
                      key={item.id}
                      onClick={() => loadDiagram(item.id)}
                      disabled={loadingId !== null}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setMenu({ id: item.id, x: e.clientX, y: e.clientY, kind: 'active' })
                      }}
                      className="w-full text-left px-4 py-3 border-b border-[var(--color-ink)]/20 hover:bg-[var(--color-accent)]/10 active:bg-[var(--color-accent)]/20 disabled:cursor-default disabled:hover:bg-transparent"
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
                        {loadingId === item.id ? (
                          <Spinner size={16} label="Cargando diagrama" className="shrink-0" />
                        ) : (
                          <Badge
                            color={BADGE_COLORS[item.diagram_type] ?? 'var(--color-accent)'}
                            className="shrink-0 text-white"
                          >
                            {TYPE_LABELS[item.diagram_type] ?? item.diagram_type}
                          </Badge>
                        )}
                      </div>
                    </button>
                  ),
                )}
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
            <>
              <button
                onClick={() => startRename(menu.id)}
                className="block w-full px-4 py-2 text-left text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-accent)]/10"
              >
                Renombrar
              </button>
              <button
                onClick={() => handleDelete(menu.id)}
                className="block w-full px-4 py-2 text-left text-sm font-semibold text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
              >
                Eliminar
              </button>
            </>
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
