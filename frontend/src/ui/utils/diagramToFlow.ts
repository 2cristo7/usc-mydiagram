import type { DiagramSchema, DiagramType, NodeType } from "../../types";
import '@xyflow/react/dist/style.css';
import type { Node, Edge } from "@xyflow/react";
import dagre from '@dagrejs/dagre';
import { sequenceLayout } from './sequenceLayout';

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
    terminator: 'flow',
    table: 'table',
    state: 'state',
    topic: 'mindmap'
};

// Overrides específicos por diagram_type para node_types que comparten nombre entre
// diagramas pero necesitan componentes distintos. El caso principal es `terminator`:
// en flowchart → FlowNode (rombo inicio/fin); en state_machine → StateNode (el único
// componente de estado disponible, evita renderizar FlowNode en un diagrama de estados).
const nodeTypeOverrides: Partial<Record<DiagramType, Partial<Record<NodeType, string>>>> = {
    state_machine: {
        terminator: 'state',
    },
};

export function DiagramToFlow(diagram: DiagramSchema): { nodes: Node[], edges: Edge[] } {
    if (diagram.diagram_type === 'sequence') {
        return sequenceLayout(diagram);
    }

    const graph = new dagre.graphlib.Graph();

    const rankdir = 'TB';

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
        // Si el nodo tiene posición guardada, respeta la del usuario.
        // Dagre solo actúa como layout inicial cuando no hay posición previa.
        const { x, y } = node.position ?? graph.node(node.id);
        return {
            id: node.id,
            position: { x, y },
            data: {
                label: node.label,
                nodeType: node.node_type,
                attributes: node.attributes,
            },
            type: nodeTypeOverrides[diagram.diagram_type]?.[node.node_type]
                ?? nodeTypeMap[node.node_type]
                ?? 'default'
        } as Node;
    });

    const edges = diagram.edges.map( (edge) => {
        return {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            sourceHandle: edge.sourceHandle ?? null,
            targetHandle: edge.targetHandle ?? null,
            // Mezclamos los datos visuales persistidos (waypoints/forma/flechas/
            // labelT) con la etiqueta del contrato. edge.data.label, si existe,
            // gana sobre edge.label (es la edición inline más reciente).
            data: { label: edge.label ?? '', ...(edge.data ?? {}) },
            type: diagram.diagram_type === 'sequence' ? 'sequenceMessage' : 'default',
        } as Edge;
    });

    return { nodes, edges };
}