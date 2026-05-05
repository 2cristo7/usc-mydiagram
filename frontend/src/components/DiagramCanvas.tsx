import type { DiagramSchema } from "../types";
import '@xyflow/react/dist/style.css';
import type { Node, Edge } from "@xyflow/react";
import { ReactFlow, Background, Controls } from "@xyflow/react";
import dagre from '@dagrejs/dagre';


export function DiagramCanvas({ diagram }: { diagram: DiagramSchema | null }) {
    if (!diagram) {
        return (
            <div className="flex-1 bg-gray-200 flex items-center justify-center">
                <p className="text-gray-600">Cargando diagrama...</p>
            </div>
        );
    }
    const { nodes, edges } = DiagramToFlow(diagram);

    return (
        <div className="flex-1 h-full w-full bg-gray-100">
            <ReactFlow nodes={nodes} edges={edges} fitView>
                <Background />
                <Controls />
            </ReactFlow>
        </div>
    );
}

function DiagramToFlow(diagram: DiagramSchema): { nodes: Node[], edges: Edge[] } {
    const graph = new dagre.graphlib.Graph();

    graph.setGraph({ rankdir: 'TB'});
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
                node_type: node.node_type,
                attributes: node.attributes,
            },
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