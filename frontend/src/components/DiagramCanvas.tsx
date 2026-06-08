import type { DiagramNode, NodeType } from "../types";
import '@xyflow/react/dist/style.css';
import type { Node } from "@xyflow/react";
import { ReactFlow, Background, Controls, Panel } from "@xyflow/react";
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
    const uiState = useStore((s) => s.uiState);
    const [selectedNode, setSelectedNode] = useState<DiagramNode | null>(null);

    // Sin diagrama, el placeholder depende del uiState (S6.9): antes mostraba
    // siempre "Cargando diagrama..." y se quedaba colgado cuando un fallo emitía
    // `error` sin que se streamease ningún nodo (currentDiagram seguía null pero
    // la generación ya había terminado). Ahora "Cargando" solo en `generating`.
    if (!currentDiagram) {
        const placeholder =
            uiState === 'generating'
                ? 'Generando diagrama...'
                : uiState === 'error'
                ? 'No se pudo generar el diagrama. Revisa el mensaje del chat e inténtalo de nuevo.'
                : 'Describe un diagrama en el chat para empezar.';
        return (
            <div className="flex-1 bg-gray-200 flex items-center justify-center">
                <p className="text-gray-600 px-6 text-center">{placeholder}</p>
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