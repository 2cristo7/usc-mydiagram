import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DiagramEdge, DiagramNode, NodeType } from '../types'
import '@xyflow/react/dist/style.css'
import type { Connection, Edge, Node, OnNodeDrag } from '@xyflow/react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ConnectionMode,
} from '@xyflow/react'
import { FileQuestion, AlertTriangle } from 'lucide-react'
import { useStore } from '../store/index'
import { useUiStore } from '../store/ui'
import { DiagramToFlow } from '../ui/utils/diagramToFlow'
import { stagingNodePositions, stagingEdges } from '../ui/utils/stagingLayout'

import { UmlClassNode } from './nodes/UmlClassNode'
import { C4Node } from './nodes/C4Node'
import { ArchitectureNode } from './nodes/ArchitectureNode'
import { ArchitectureGroupNode } from './nodes/ArchitectureGroupNode'
import { SequenceActorNode } from './nodes/SequenceActorNode'
import { FlowNode } from './nodes/FlowNode'
import { TableNode } from './nodes/TableNode'
import { StateNode } from './nodes/StateNode'
import { MindmapNode } from './nodes/MindmapNode'
import { LifelineNode } from './nodes/LifelineNode'
import { ActivationNode } from './nodes/ActivationNode'
import { SequenceMessageEdge, EditableEdge, EdgeMarkers, MindmapBranchEdge, ArchitectureEdge } from './edges'
import { architectureLayoutElk } from '../ui/utils/architectureLayout'
import { EdgeContextMenu } from './edges/EdgeContextMenu'
import { NodeContextMenu } from './nodes/NodeContextMenu'
import { persistCurrentDiagram } from '../lib/api'
import { beginHistoryInteraction, endHistoryInteraction } from '../store/historyManager'
import { GRID_SIZE } from '../ui/utils/grid'

const nodeTypes = {
  umlClass: UmlClassNode,
  c4: C4Node,
  architecture: ArchitectureNode,
  architectureGroup: ArchitectureGroupNode,
  sequenceActor: SequenceActorNode,
  flow: FlowNode,
  table: TableNode,
  state: StateNode,
  mindmap: MindmapNode,
  lifeline: LifelineNode,
  activation: ActivationNode,
}

const edgeTypes = {
  sequenceMessage: SequenceMessageEdge,
  mindmapBranch: MindmapBranchEdge,
  architecture: ArchitectureEdge,
  default: EditableEdge,
}

export function DiagramCanvas() {
  const { currentDiagram, addNode, updateNodePosition } = useStore()
  const uiState = useStore((s) => s.uiState)
  const generationPhase = useStore((s) => s.generationPhase)
  const streamingNodes = useStore((s) => s.nodes)
  const streamingEdges = useStore((s) => s.edges)
  const addEdge = useStore((s) => s.addEdge)
  const canvasLocked = useUiStore((s) => s.canvasLocked)
  const gridEnabled = useUiStore((s) => s.gridEnabled)
  const [, setSelectedNode] = useState<DiagramNode | null>(null)
  const [edgeMenu, setEdgeMenu] = useState<{ edgeId: string; x: number; y: number } | null>(null)
  const [nodeMenu, setNodeMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null)

  const isConnecting = useRef(false)
  const [, setConnectingTarget] = useState<string | null>(null)

  const onEdgeContextMenu = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.preventDefault()
    setNodeMenu(null)
    setEdgeMenu({ edgeId: edge.id, x: event.clientX, y: event.clientY })
  }, [])

  const closeEdgeMenu = useCallback(() => setEdgeMenu(null), [])

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault()
    setEdgeMenu(null)
    setNodeMenu({ nodeId: node.id, x: event.clientX, y: event.clientY })
  }, [])

  const closeNodeMenu = useCallback(() => setNodeMenu(null), [])

  // Borrado de nodos (tecla Supr/Retroceso): React Flow quita el nodo de su estado
  // local, pero la verdad vive en el store (currentDiagram), que se re-siembra; hay
  // que reflejar el borrado allí (removeNode arrastra las aristas incidentes) y
  // persistir para que sobreviva a una recarga. Lectura fresca del store por si el
  // borrado afecta a varios nodos a la vez (selección múltiple).
  const onNodesDelete = useCallback((deleted: Node[]) => {
    const { edges, removeNode } = useStore.getState()
    deleted.forEach((n) => {
      const edgeIds = edges.filter((e) => e.source === n.id || e.target === n.id).map((e) => e.id)
      removeNode(n.id, edgeIds)
    })
    void persistCurrentDiagram()
  }, [])

  // Borrado de aristas por teclado (mismo motivo: reflejar en el store + persistir).
  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    const { removeEdge } = useStore.getState()
    deleted.forEach((e) => removeEdge(e.id))
    void persistCurrentDiagram()
  }, [])

  const onConnectStart = useCallback(() => {
    isConnecting.current = true
    setConnectingTarget(null)
  }, [])

  const onConnectEnd = useCallback(() => {
    isConnecting.current = false
    setConnectingTarget(null)
    document.querySelectorAll('.react-flow__node.snap-target').forEach((el) => {
      el.classList.remove('snap-target')
    })
  }, [])

  const onNodeMouseEnter = useCallback((_event: React.MouseEvent, node: Node) => {
    if (!isConnecting.current) return
    setConnectingTarget(node.id)
    document.querySelector(`.react-flow__node[data-id="${node.id}"]`)?.classList.add('snap-target')
  }, [])

  const onNodeMouseLeave = useCallback(() => {
    setConnectingTarget(null)
    document.querySelectorAll('.react-flow__node.snap-target').forEach((el) => {
      el.classList.remove('snap-target')
    })
  }, [])

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return
    addEdge({
      id: `e-${connection.source}-${connection.target}-${Date.now()}`,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle ?? undefined,
      targetHandle: connection.targetHandle ?? undefined,
      label: '',
      // Tipo semántico por defecto para aristas creadas a mano (Miro-style).
      edge_type: 'association',
      data: { shape: 'curved', strokeStyle: 'normal', targetArrow: true },
    } as DiagramEdge)
  }, [addEdge])

  // ── Estado controlado del canvas interactivo ───────────────────────────────
  // React Flow v12 exige nodos/aristas controlados (con onNodesChange) para que
  // el arrastre siga al ratón en vivo. Derivamos del store via DiagramToFlow y
  // re-sembramos el estado local cada vez que cambia currentDiagram (nueva
  // generación, edición desde IA, persistencia de posición tras soltar).
  const { screenToFlowPosition, getNodes } = useReactFlow()
  const derived = useMemo(
    () => (currentDiagram ? DiagramToFlow(currentDiagram) : { nodes: [], edges: [] }),
    [currentDiagram],
  )
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(derived.nodes)
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(derived.edges)
  useEffect(() => {
    setRfNodes(derived.nodes)
    setRfEdges(derived.edges)
  }, [derived, setRfNodes, setRfEdges])

  // Refinamiento async ELK para diagramas de arquitectura.
  // El layout provisional síncrono (de useMemo) ya pintó algo; cuando ELK resuelve
  // sobrescribimos las posiciones con el resultado final, sin parpadeo perceptible.
  useEffect(() => {
    if (!currentDiagram || currentDiagram.diagram_type !== 'architecture') return
    if (generationPhase === 'staging' || generationPhase === 'assembling') return

    let cancelled = false
    architectureLayoutElk(currentDiagram).then(({ nodes: elkNodes, edges: elkEdges }) => {
      if (cancelled) return
      setRfNodes(elkNodes)
      setRfEdges(elkEdges)
    })

    return () => {
      cancelled = true
    }
  }, [currentDiagram, generationPhase, setRfNodes, setRfEdges])

  // ── FASE STAGING ────────────────────────────────────────────────────────────
  // Durante 'staging' mostramos el almacén: nodos en fila superior (reales, con
  // su tipo custom) y aristas nativas con etiqueta.
  // Nunca hay currentDiagram definitivo aquí (el snapshot llega en diagram:done).
  if (generationPhase === 'staging') {
    return (
      <div className="relative flex h-full w-full">
        {/* Banner informativo superpuesto */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 bg-[var(--color-surface)] border-[2px] border-[var(--color-ink)] shadow-[var(--shadow-brutal)] text-xs font-semibold text-[var(--color-ink)] pointer-events-none">
          Recibiendo elementos… ({streamingNodes.length} nodos · {streamingEdges.length} aristas)
        </div>
        <ReactFlow
          nodes={stagingNodePositions(streamingNodes)}
          edges={stagingEdges(streamingEdges)}
          fitView
          nodesDraggable={false}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          onNodeMouseEnter={onNodeMouseEnter}
          onNodeMouseLeave={onNodeMouseLeave}
          onEdgeContextMenu={onEdgeContextMenu}
          onPaneClick={closeEdgeMenu}
          className="bg-[var(--color-bg)]"
          proOptions={{ hideAttribution: false }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            color="var(--color-ink)"
            gap={20}
            size={1}
            style={{ opacity: 0.12 }}
          />
        </ReactFlow>
      </div>
    )
  }

  // ── FASE ASSEMBLING ─────────────────────────────────────────────────────────
  // El snapshot final ya llegó (applyDiagram ya actualizó currentDiagram).
  // Calculamos el layout final y renderizamos con la clase 'is-assembling' en el
  // wrapper, que activa via CSS una transición de transform en los nodos React Flow.
  // React Flow verá que las posiciones cambiaron y animará el movimiento.
  if (generationPhase === 'assembling' && currentDiagram) {
    const { nodes: finalNodes, edges: finalEdges } = DiagramToFlow(currentDiagram)

    return (
      <div className="relative flex h-full w-full is-assembling">
        <EdgeMarkers />
        <ReactFlow
          nodes={finalNodes}
          edges={finalEdges}
          fitView
          nodesDraggable={false}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          onNodeMouseEnter={onNodeMouseEnter}
          onNodeMouseLeave={onNodeMouseLeave}
          onEdgeContextMenu={onEdgeContextMenu}
          onPaneClick={closeEdgeMenu}
          className="bg-[var(--color-bg)]"
        >
          <Background
            variant={BackgroundVariant.Dots}
            color="var(--color-ink)"
            gap={20}
            size={1}
            style={{ opacity: 0.12 }}
          />
          <MiniMap
            className="border-[3px] border-[var(--color-ink)] shadow-[var(--shadow-brutal)]"
            nodeColor="var(--color-accent)"
            style={{ background: 'var(--color-surface)' }}
          />
        </ReactFlow>
      </div>
    )
  }

  // ── FASE DONE / IDLE ────────────────────────────────────────────────────────
  // Comportamiento normal: sin diagrama → estados vacíos; con diagrama → canvas
  // interactivo completo (drag, drop, propiedades).

  if (!currentDiagram) {
    if (uiState === 'generating') {
      return (
        <div className="flex h-full w-full items-center justify-center bg-[var(--color-bg)]">
          <div className="flex flex-col items-center gap-4">
            <div className="h-12 w-12 border-[4px] border-[var(--color-ink)] border-t-[var(--color-accent)] animate-spin" />
            <p className="text-sm font-semibold text-[var(--color-ink)]">
              Generando diagrama...
            </p>
          </div>
        </div>
      )
    }
    if (uiState === 'error') {
      return (
        <div className="flex h-full w-full items-center justify-center bg-[var(--color-bg)]">
          <div className="max-w-sm border-[3px] border-[var(--color-danger)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-brutal)] text-center">
            <AlertTriangle size={32} className="mx-auto mb-2 text-[var(--color-danger)]" />
            <p className="text-sm font-semibold text-[var(--color-ink)]">
              No se pudo generar el diagrama.
            </p>
            <p className="mt-1 text-xs text-[var(--color-ink)]/60">
              Revisa el chat e inténtalo de nuevo.
            </p>
          </div>
        </div>
      )
    }
    return (
      <div className="flex h-full w-full items-center justify-center bg-[var(--color-bg)]">
        <div className="flex flex-col items-center gap-3 text-center">
          <FileQuestion size={48} className="text-[var(--color-ink)]/30" />
          <p className="text-sm font-semibold text-[var(--color-ink)]/60">
            Describe un diagrama en el chat para empezar
          </p>
        </div>
      </div>
    )
  }

  function onDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const nodeType = event.dataTransfer.getData('nodeType') as NodeType
    if (!nodeType) return
    const label = event.dataTransfer.getData('nodeLabel') || nodeType

    // Congela las posiciones renderizadas actuales para que dagre no reordene el
    // canvas al añadir el nodo (mismo criterio que la antigua NodePalette).
    getNodes().forEach((rfNode) => {
      const storeNode = currentDiagram?.nodes.find((n) => n.id === rfNode.id)
      if (storeNode && !storeNode.position) {
        updateNodePosition(rfNode.id, rfNode.position)
      }
    })

    // Traduce las coordenadas de pantalla del cursor a coordenadas de flujo.
    const dropped = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    // En secuencia los actores viven en la cabecera (y:0); solo respetamos X.
    const isSequence = currentDiagram?.diagram_type === 'sequence'
    const position = isSequence ? { x: dropped.x, y: 0 } : dropped

    const diagramNode: DiagramNode = {
      id: crypto.randomUUID(),
      label: `Nuevo ${label}`,
      node_type: nodeType,
      attributes: [],
      position,
    }
    addNode(diagramNode)
  }

  function onNodeClick(_event: React.MouseEvent, node: Node) {
    const diagramNode = currentDiagram?.nodes.find((n) => n.id === node.id) ?? null
    setSelectedNode(diagramNode)
  }

  // Persiste la posición tras soltar un nodo.
  // Para diagramas de secuencia: los actores solo se mueven en X (su Y se fija
  // siempre en la cabecera = 0). Lifelines y activaciones no son arrastrables
  // (draggable:false en sequenceLayout), así que nunca llegan aquí.
  // Inicio del arrastre de un nodo: marca el comienzo del gesto para que el
  // historial capture una sola entrada (el estado previo) en vez de una por cada
  // posición intermedia.
  const onNodeDragStart: OnNodeDrag<Node> = () => {
    beginHistoryInteraction()
  }

  const onNodeDragStop: OnNodeDrag<Node> = (_event, node) => {
    const isSequence = currentDiagram?.diagram_type === 'sequence'
    const diagramNode = currentDiagram?.nodes.find((n) => n.id === node.id)
    if (!diagramNode) {
      endHistoryInteraction()
      return
    }

    const x = node.position.x
    // En diagramas de secuencia los actores quedan siempre en y:0 (HEADER_H fija la
    // cabecera). Fijamos y=0 aquí para neutralizar cualquier deriva vertical.
    const y = isSequence && diagramNode.node_type === 'actor' ? 0 : node.position.y

    updateNodePosition(node.id, { x, y })
    // Cierra el gesto: el cambio de posición ya se aplicó dentro de la ventana
    // suspendida, así que queda una única entrada de historial.
    endHistoryInteraction()
  }

  return (
    <div className="relative flex h-full w-full">
      <EdgeMarkers />
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        nodesDraggable={!canvasLocked}
        nodesConnectable={!canvasLocked}
        elementsSelectable={!canvasLocked}
        snapToGrid={gridEnabled}
        snapGrid={[GRID_SIZE, GRID_SIZE]}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        deleteKeyCode={['Delete', 'Backspace']}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onEdgeContextMenu={onEdgeContextMenu}
        onPaneClick={() => { setSelectedNode(null); closeEdgeMenu(); closeNodeMenu() }}
        connectionMode={ConnectionMode.Loose}
        className="bg-[var(--color-bg)]"
      >
        <Background
          variant={gridEnabled ? BackgroundVariant.Lines : BackgroundVariant.Dots}
          color="var(--color-ink)"
          gap={GRID_SIZE}
          size={1}
          style={{ opacity: gridEnabled ? 0.18 : 0.12 }}
        />
        <MiniMap
          className="border-[3px] border-[var(--color-ink)] shadow-[var(--shadow-brutal)]"
          nodeColor="var(--color-accent)"
          style={{ background: 'var(--color-surface)' }}
        />
      </ReactFlow>
      {edgeMenu && (
        <EdgeContextMenu
          edgeId={edgeMenu.edgeId}
          position={{ x: edgeMenu.x, y: edgeMenu.y }}
          onClose={closeEdgeMenu}
        />
      )}
      {nodeMenu && (
        <NodeContextMenu
          nodeId={nodeMenu.nodeId}
          position={{ x: nodeMenu.x, y: nodeMenu.y }}
          onClose={closeNodeMenu}
        />
      )}
    </div>
  )
}
