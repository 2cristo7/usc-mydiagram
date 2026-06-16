import { useEffect, useRef } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { useStore } from '../../store'
import { persistCurrentDiagram } from '../../lib/api'

export interface NodeContextMenuProps {
  nodeId: string
  position: { x: number; y: number }
  onClose: () => void
}

// Menú contextual de nodo (clic derecho): editar la etiqueta inline o eliminar
// el nodo. Espejo de EdgeContextMenu. El borrado pasa por el store (removeNode,
// que también arrastra las aristas incidentes declaradas aquí) y persiste para
// que sobreviva a una recarga.
export function NodeContextMenu({ nodeId, position, onClose }: NodeContextMenuProps) {
  const removeNode = useStore((s) => s.removeNode)
  const requestNodeEdit = useStore((s) => s.requestNodeEdit)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // Captura: React Flow hace stopPropagation en el mousedown del nodo, así que
    // un clic sobre el propio nodo no burbujea hasta document. Escuchando en fase
    // de captura el cierre se dispara antes, también al clicar el nodo.
    document.addEventListener('mousedown', handleClickOutside, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  function handleEdit() {
    requestNodeEdit(nodeId)
    onClose()
  }

  function handleDelete() {
    // Cascade de aristas incidentes: se calcula aquí (lectura fresca del store) y
    // se pasa a removeNode, que las borra junto al nodo (mismo contrato que el
    // delta del agente: el llamante declara qué aristas caen).
    const edges = useStore.getState().edges
    const edgeIds = edges.filter((e) => e.source === nodeId || e.target === nodeId).map((e) => e.id)
    removeNode(nodeId, edgeIds)
    void persistCurrentDiagram()
    onClose()
  }

  const itemBase =
    'flex items-center gap-2 px-2 py-1.5 text-xs font-semibold border-2 rounded cursor-pointer select-none transition-colors w-full text-left'

  return (
    <div
      ref={menuRef}
      style={{ position: 'fixed', left: position.x, top: position.y, zIndex: 9999 }}
      className="min-w-[160px] bg-[var(--color-surface)] border-2 border-[var(--color-ink)] shadow-[3px_3px_0_var(--color-ink)] rounded-lg p-2 flex flex-col gap-2"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        onClick={handleEdit}
        className={`${itemBase} border-[var(--color-ink)] text-[var(--color-ink)] hover:bg-[var(--color-ink)]/10`}
      >
        <Pencil size={13} />
        Editar
      </button>
      <button
        onClick={handleDelete}
        className={`${itemBase} border-red-500 text-red-600 hover:bg-red-50`}
      >
        <Trash2 size={13} />
        Eliminar nodo
      </button>
    </div>
  )
}
