import type { DiagramSchema, NodeType } from "../../types";
import '@xyflow/react/dist/style.css';
import type { Node, Edge } from "@xyflow/react";
import dagre from '@dagrejs/dagre';

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
};

export function DiagramToFlow(diagram: DiagramSchema): { nodes: Node[], edges: Edge[] } {
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