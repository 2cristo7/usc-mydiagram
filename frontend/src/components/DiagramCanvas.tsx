import type { DiagramNode, DiagramSchema, NodeType } from "../types";
import '@xyflow/react/dist/style.css';
import type { Node, Edge } from "@xyflow/react";
import { ReactFlow, Background, Controls, Panel } from "@xyflow/react";
import dagre from '@dagrejs/dagre';
import { useStore } from "../store/index";
import { NodePalette } from "./NodePalette";
import { useState } from "react";
import { NodePropertiesPanel } from "./NodePropertiesPanel";
import { DiagramToFlow } from "../ui/utils/diagramToFlow";

import { UmlClassNode } from "./UmlClassNode";
import { C4Node } from "./C4Node";
import { ArchitectureNode } from "./ArchitectureNode";
import { SequenceActorNode } from "./SequenceActorNode";
import { FlowNode } from "./FlowNode";



const nodeTypes = { umlClass: UmlClassNode, c4: C4Node, architecture: ArchitectureNode, sequenceActor: SequenceActorNode, flow: FlowNode };

export function DiagramCanvas() {
    const { currentDiagram, addNode } = useStore();
    const [selectedNode, setSelectedNode] = useState<DiagramNode | null>(null);

    if (!currentDiagram) {
        return (
            <div className="flex-1 bg-gray-200 flex items-center justify-center">
                <p className="text-gray-600">Cargando diagrama...</p>
            </div>
        );
    }
    const { nodes, edges } = DiagramToFlow(currentDiagram);

    function onDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
}

    function onDrop(event: React.DragEvent<HTMLDivElement>) {
        event.preventDefault();
        const nodeType = event.dataTransfer.getData('nodeType') as NodeType;
        const diagramNode: DiagramNode = {
            id: crypto.randomUUID(),
            label: nodeType.charAt(0).toUpperCase() + nodeType.slice(1),
            node_type: nodeType,
            attributes: []
        };
        addNode(diagramNode);
    }

    function onNodeClick(_event: React.MouseEvent, node: Node) {
        const diagramNode = currentDiagram?.nodes.find(n => n.id === node.id) ?? null;
        setSelectedNode(diagramNode);
    }

    return (
        <div className="flex h-full w-full bg-gray-100">
            <ReactFlow nodes={nodes} edges={edges} fitView nodeTypes={nodeTypes} onDrop={onDrop} onDragOver={onDragOver} onNodeClick={onNodeClick}>
                <Panel position="top-left">
                    <NodePalette></NodePalette>
                </Panel>
                <Background />
                <Controls />
            </ReactFlow>
            <div className="w-72 border-l bg-white">
                <NodePropertiesPanel node={selectedNode} />
            </div>
        </div>
    );
}