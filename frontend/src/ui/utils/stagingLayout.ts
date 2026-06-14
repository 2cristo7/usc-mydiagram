// Disposición visual del "almacén" durante la fase de streaming (generationPhase === 'staging').
//
// Los nodos reales llegan por streaming y se colocan en una fila horizontal
// en la parte superior del canvas. Las aristas se representan como aristas
// nativas de React Flow con etiqueta, para que el usuario vea ambos llegar.
//
// Esta utilidad es PURA (sin side-effects): recibe arrays y devuelve posiciones.
// DiagramCanvas la llama en cada render durante 'staging'.

import type { DiagramNode, DiagramEdge } from '../../types';
import type { Node, Edge } from '@xyflow/react';

// Espacio horizontal entre nodos en la fila del almacén.
const NODE_ITEM_WIDTH = 180;
const NODE_ITEM_GAP = 20;
// Altura fija de la fila de nodos (referencial para fitView).
export const STAGING_NODE_ROW_Y = 40;

// Calcula las posiciones React Flow de los nodos en la fila superior del almacén.
// Los nodos conservan su tipo custom real para que el usuario vea el look final.
export function stagingNodePositions(
    nodes: DiagramNode[],
): Node[] {
    return nodes.map((node, index) => ({
        id: node.id,
        position: {
            x: index * (NODE_ITEM_WIDTH + NODE_ITEM_GAP),
            y: STAGING_NODE_ROW_Y,
        },
        data: {
            label: node.label,
            nodeType: node.node_type,
            attributes: node.attributes,
        },
        // Sin posición arrastrable durante staging: el usuario no debe
        // reorganizar nada hasta que el diagrama esté ensamblado.
        draggable: false,
        // Guardamos el tipo real para que se renderice con el componente correcto.
        type: node.node_type === 'table' ? 'table'
            : node.node_type === 'class' ? 'umlClass'
            : node.node_type === 'actor' ? 'sequenceActor'
            : node.node_type === 'step' || node.node_type === 'decision' || node.node_type === 'terminator' ? 'flow'
            : node.node_type === 'person' || node.node_type === 'system' || node.node_type === 'container' || node.node_type === 'component' ? 'c4'
            : node.node_type === 'gateway' || node.node_type === 'service' || node.node_type === 'database' || node.node_type === 'queue' ? 'architecture'
            : node.node_type === 'state' ? 'state'
            : node.node_type === 'topic' ? 'mindmap'
            : 'default',
    }));
}

// Convierte las aristas de staging en aristas nativas de React Flow con data.label,
// listas para que EditableEdge las renderice como etiquetas editables.
export function stagingEdges(edges: DiagramEdge[]): Edge[] {
    return edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        data: { label: edge.label ?? '' },
        type: 'default',
    }));
}
