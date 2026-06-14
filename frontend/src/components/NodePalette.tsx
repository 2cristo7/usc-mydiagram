/**
 * NodePalette — panel desplegable anclado al EditToolbar (columna inline,
 * no overlay) que lista los node_types válidos del diagrama activo.
 *
 * Modo de uso: arrastrar (drag and drop). Cada tipo es un elemento `draggable`
 * que, al iniciar el arrastre, escribe su tipo y etiqueta en `dataTransfer`. El
 * navegador muestra de forma nativa un "fantasma" del botón siguiendo al cursor.
 * El canvas (DiagramCanvas) escucha onDrop/onDragOver: traduce la posición del
 * cursor a coordenadas de flujo con screenToFlowPosition y crea el nodo ahí.
 *
 * La paleta queda abierta tras soltar para permitir añadir varios nodos; se
 * cierra con la X.
 */

import { useReactFlow } from '@xyflow/react'
import { X } from 'lucide-react'
import { useStore } from '../store/index'
import { useUiStore } from '../store/ui'
import { getNodeTypesForDiagram } from '../ui/utils/diagramNodeTypes'
import type { NodeTypeInfo } from '../ui/utils/diagramNodeTypes'

export function NodePalette() {
  const { setNodePaletteOpen } = useUiStore()
  const currentDiagram = useStore((s) => s.currentDiagram)

  // useReactFlow garantiza que la paleta vive dentro del ReactFlowProvider,
  // igual que el canvas que recibe el drop.
  useReactFlow()

  const nodeTypes = getNodeTypesForDiagram(currentDiagram?.diagram_type ?? null)

  function onDragStart(event: React.DragEvent<HTMLButtonElement>, info: NodeTypeInfo) {
    event.dataTransfer.setData('nodeType', info.type)
    event.dataTransfer.setData('nodeLabel', info.label)
    event.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div
      className="flex flex-col border-r-[3px] border-[var(--color-ink)] bg-[var(--color-surface)] h-full overflow-y-auto"
      style={{ width: 160 }}
      data-testid="node-palette"
    >
      {/* Cabecera */}
      <div className="flex items-center justify-between px-3 py-2 border-b-[3px] border-[var(--color-ink)] shrink-0">
        <span className="text-xs font-bold text-[var(--color-ink)] uppercase tracking-wide">
          Añadir nodo
        </span>
        <button
          onClick={() => setNodePaletteOpen(false)}
          className="text-[var(--color-ink)] hover:text-[var(--color-accent)] leading-none"
          aria-label="Cerrar paleta"
        >
          <X size={14} />
        </button>
      </div>

      {/* Lista de tipos (arrastrables hacia el canvas) */}
      {nodeTypes.length === 0 ? (
        <p className="text-xs text-[var(--color-ink)]/50 px-3 py-4 text-center">
          {currentDiagram ? 'Sin tipos disponibles' : 'Carga un diagrama primero'}
        </p>
      ) : (
        <div className="flex flex-col py-1">
          <p className="text-[10px] text-[var(--color-ink)]/50 px-3 pb-1 leading-tight">
            Arrastra un tipo al lienzo
          </p>
          {nodeTypes.map((info) => (
            <button
              key={info.type}
              draggable
              onDragStart={(e) => onDragStart(e, info)}
              className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-accent)]/10 active:bg-[var(--color-accent)]/20 text-left transition-colors cursor-grab active:cursor-grabbing"
              title={`Arrastra para añadir un nodo de tipo ${info.label}`}
            >
              <span
                className="shrink-0 text-base leading-none w-5 text-center select-none"
                aria-hidden="true"
              >
                {info.symbol}
              </span>
              <span className="truncate">{info.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
