import { useState } from 'react'
import type { DiagramNode, NodeType } from '../types'
import '@xyflow/react/dist/style.css'
import type { Node } from '@xyflow/react'
import { ReactFlow, Background, BackgroundVariant, Controls, MiniMap } from '@xyflow/react'
import { FileQuestion, AlertTriangle } from 'lucide-react'
import { useStore } from '../store/index'
import { NodePropertiesPanel } from './NodePropertiesPanel'
import { DiagramToFlow } from '../ui/utils/diagramToFlow'

import { UmlClassNode } from './nodes/UmlClassNode'
import { C4Node } from './nodes/C4Node'
import { ArchitectureNode } from './nodes/ArchitectureNode'
import { SequenceActorNode } from './nodes/SequenceActorNode'
import { FlowNode } from './nodes/FlowNode'
import { TableNode } from './nodes/TableNode'
import { StateNode } from './nodes/StateNode'
import { MindmapNode } from './nodes/MindmapNode'
import { LifelineNode } from './nodes/LifelineNode'
import { ActivationNode } from './nodes/ActivationNode'
import { SequenceMessageEdge } from './edges/SequenceMessageEdge'

const nodeTypes = {
  umlClass: UmlClassNode,
  c4: C4Node,
  architecture: ArchitectureNode,
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
}

export function DiagramCanvas() {
  const { currentDiagram, addNode } = useStore()
  const uiState = useStore((s) => s.uiState)
  const [selectedNode, setSelectedNode] = useState<DiagramNode | null>(null)

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

  const { nodes, edges } = DiagramToFlow(currentDiagram)

  function onDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const nodeType = event.dataTransfer.getData('nodeType') as NodeType
    const diagramNode: DiagramNode = {
      id: crypto.randomUUID(),
      label: nodeType.charAt(0).toUpperCase() + nodeType.slice(1),
      node_type: nodeType,
      attributes: [],
    }
    addNode(diagramNode)
  }

  function onNodeClick(_event: React.MouseEvent, node: Node) {
    const diagramNode = currentDiagram?.nodes.find((n) => n.id === node.id) ?? null
    setSelectedNode(diagramNode)
  }

  return (
    <div className="relative flex h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeClick={onNodeClick}
        onPaneClick={() => setSelectedNode(null)}
        className="bg-[var(--color-bg)]"
      >
        <Background
          variant={BackgroundVariant.Dots}
          color="var(--color-ink)"
          gap={20}
          size={1}
          style={{ opacity: 0.12 }}
        />
        <Controls className="border-[3px] border-[var(--color-ink)] shadow-[var(--shadow-brutal)]" />
        <MiniMap
          className="border-[3px] border-[var(--color-ink)] shadow-[var(--shadow-brutal)]"
          nodeColor="var(--color-accent)"
          style={{ background: 'var(--color-surface)' }}
        />
      </ReactFlow>
      {selectedNode && <NodePropertiesPanel node={selectedNode} />}
    </div>
  )
}
