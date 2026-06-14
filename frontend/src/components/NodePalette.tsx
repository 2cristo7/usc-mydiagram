/**
 * NodePalette — panel desplegable anclado al EditToolbar (columna inline,
 * no overlay) que lista los node_types válidos del diagrama activo y permite
 * añadir un nodo al canvas con un clic.
 *
 * Estrategia anti-reordenamiento dagre:
 *   Antes de añadir el nodo nuevo, captura las posiciones renderizadas actuales
 *   de React Flow y persiste cada una via updateNodePosition. Así diagramToFlow
 *   respeta la posición guardada (node.position ?? dagre) y no recoloca nada.
 *
 * Para sequence: el nuevo actor se coloca a la derecha de los actores existentes
 *   en la fila de cabecera (y ≈ 0) sumando un offset fijo en X.
 */

import { useCallback } from 'react'
import { useReactFlow } from '@xyflow/react'
import { X } from 'lucide-react'
import { useStore } from '../store/index'
import { useUiStore } from '../store/ui'
import { getNodeTypesForDiagram } from '../ui/utils/diagramNodeTypes'
import type { NodeTypeInfo } from '../ui/utils/diagramNodeTypes'
import type { DiagramNode } from '../types'

/** Genera un id único slug-based con timestamp para evitar colisiones. */
function makeNodeId(nodeType: string): string {
  return `${nodeType}_${Date.now()}_${Math.floor(Math.random() * 1000)}`
}

/** Calcula la posición para el nuevo nodo en un diagrama no-secuencia.
 *  Devuelve el centro del viewport actual más un offset aleatorio pequeño
 *  para evitar apilar nodos exactamente en el mismo punto. */
function calcPositionDefault(
  getViewport: () => { x: number; y: number; zoom: number },
  width: number,
  height: number,
): { x: number; y: number } {
  const vp = getViewport()
  // Centro del viewport en coordenadas de flujo
  const cx = (-vp.x + width / 2) / vp.zoom
  const cy = (-vp.y + height / 2) / vp.zoom
  const jitter = () => (Math.random() - 0.5) * 60
  return { x: Math.round(cx + jitter()), y: Math.round(cy + jitter()) }
}

/** Posición para un nuevo actor en sequence: a la derecha del último actor. */
function calcSequenceActorPosition(existingNodes: DiagramNode[]): { x: number; y: number } {
  const ACTOR_SPACING = 200
  const HEADER_Y = 40
  if (existingNodes.length === 0) return { x: 100, y: HEADER_Y }
  const maxX = Math.max(...existingNodes.map((n) => n.position?.x ?? 0))
  return { x: maxX + ACTOR_SPACING, y: HEADER_Y }
}

export function NodePalette() {
  const { setNodePaletteOpen } = useUiStore()
  const currentDiagram = useStore((s) => s.currentDiagram)
  const addNode = useStore((s) => s.addNode)
  const updateNodePosition = useStore((s) => s.updateNodePosition)
  const storeNodes = useStore((s) => s.nodes)

  const { getViewport, getNodes } = useReactFlow()

  const nodeTypes = getNodeTypesForDiagram(currentDiagram?.diagram_type ?? null)

  const handleAdd = useCallback(
    (info: NodeTypeInfo) => {
      const diagramType = currentDiagram?.diagram_type

      // 1. Congela posiciones existentes para que dagre no reordene el canvas.
      //    Capturamos las posiciones renderizadas de React Flow (fuente veraz)
      //    y las persistimos en el store solo si el nodo aún no tiene posición.
      if (diagramType !== 'sequence') {
        const rfNodes = getNodes()
        rfNodes.forEach((rfNode) => {
          const storeNode = storeNodes.find((n) => n.id === rfNode.id)
          if (storeNode && !storeNode.position) {
            updateNodePosition(rfNode.id, rfNode.position)
          }
        })
      }

      // 2. Calcula posición para el nuevo nodo.
      let position: { x: number; y: number }
      if (diagramType === 'sequence') {
        position = calcSequenceActorPosition(storeNodes)
      } else {
        // Usamos el tamaño real del viewport; si no hay window cae a 800×600.
        const w = typeof window !== 'undefined' ? window.innerWidth : 800
        const h = typeof window !== 'undefined' ? window.innerHeight : 600
        position = calcPositionDefault(getViewport, w, h)
      }

      // 3. Crea y añade el nodo.
      const newNode: DiagramNode = {
        id: makeNodeId(info.type),
        label: `Nuevo ${info.label}`,
        node_type: info.type,
        attributes: [],
        position,
      }
      addNode(newNode)

      // 4. Cierra la paleta.
      setNodePaletteOpen(false)
    },
    [currentDiagram, storeNodes, getNodes, getViewport, updateNodePosition, addNode, setNodePaletteOpen],
  )

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

      {/* Lista de tipos */}
      {nodeTypes.length === 0 ? (
        <p className="text-xs text-[var(--color-ink)]/50 px-3 py-4 text-center">
          {currentDiagram ? 'Sin tipos disponibles' : 'Carga un diagrama primero'}
        </p>
      ) : (
        <div className="flex flex-col py-1">
          {nodeTypes.map((info) => (
            <button
              key={info.type}
              onClick={() => handleAdd(info)}
              className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-accent)]/10 active:bg-[var(--color-accent)]/20 text-left transition-colors"
              title={`Añadir nodo de tipo ${info.label}`}
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
