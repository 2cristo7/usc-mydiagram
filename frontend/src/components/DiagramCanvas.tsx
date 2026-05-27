import type { DiagramNode, DiagramSchema, NodeType } from "../types";
import '@xyflow/react/dist/style.css';
import type { Node, Edge } from "@xyflow/react";
import { ReactFlow, Background, Controls, Panel } from "@xyflow/react";
import dagre from '@dagrejs/dagre';
import { useStore } from "../store/index";

import { UmlClassNode } from "./UmlClassNode";
import { C4Node } from "./C4Node";
import { ArchitectureNode } from "./ArchitectureNode";
import { SequenceActorNode } from "./SequenceActorNode";
import { FlowNode } from "./FlowNode";

import { NodePalette } from "./NodePalette";

const nodeTypes = { umlClass: UmlClassNode, c4: C4Node, architecture: ArchitectureNode, sequenceActor: SequenceActorNode, flow: FlowNode };

const nodeTypeMap: Partial<Record<NodeType, string>> = {
    class: 'umlClass',
    person: 'c4',
    system: 'c4',
    container: 'c4',
    component: 'c4',
    gateway: 'architecture',
    service: 'architecture',
    database: 'architecture',
    queue: 'architecture',
    actor: 'sequenceActor',
    step: 'flow',
    decision: 'flow',
    terminator: 'flow'
  }

export function DiagramCanvas() {
    const { currentDiagram, addNode } = useStore();

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
    return (
        <div className="flex-1 h-full w-full bg-gray-100">
            <ReactFlow nodes={nodes} edges={edges} fitView nodeTypes={nodeTypes} onDrop={onDrop} onDragOver={onDragOver}>
                <Panel position="top-left">
                    <NodePalette></NodePalette>
                </Panel>
                <Background />
                <Controls />
            </ReactFlow>
        </div>
    );
}

function DiagramToFlow(diagram: DiagramSchema): { nodes: Node[], edges: Edge[] } {
    const graph = new dagre.graphlib.Graph();

    const rankdir = diagram.diagram_type === 'sequence' ? 'LR' : 'TB';

    graph.setGraph({ rankdir });
    graph.setDefaultEdgeLabel(() => ({}));

    diagram.nodes.forEach( (node) => {
        graph.setNode(node.id, { label: node.label, width: 150, height: 50 });
    });

    diagram.edges.forEach( (edge) => {
        graph.setEdge(edge.source, edge.target, { label: edge.label });
    });

    dagre.layout(graph);

    const nodes = diagram.nodes.map( (node) => {
        const { x, y } = graph.node(node.id);
        return {
            id: node.id,
            position: { x, y },
            data: { 
                label: node.label,
                nodeType: node.node_type,
                attributes: node.attributes,
            },
            type: nodeTypeMap[node.node_type] ?? 'default'        
        } as Node;
    });

    const edges = diagram.edges.map( (edge) => {
        return {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            label: edge.label,
        } as Edge;
    });

    return { nodes, edges };
}