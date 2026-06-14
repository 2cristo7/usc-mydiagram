// Disposición visual del "almacén" durante la fase de streaming (generationPhase === 'staging').
//
// Los nodos reales llegan por streaming y se colocan en una fila horizontal
// en la parte superior del canvas. Las aristas se representan como "fichas"
// (chips) en una segunda fila justo debajo, para que el usuario vea ambos
// llegar sin que se dibujen conexiones reales (aún no hay layout).
//
// Esta utilidad es PURA (sin side-effects): recibe arrays y devuelve posiciones.
// DiagramCanvas la llama en cada render durante 'staging'.

import type { DiagramNode, DiagramEdge } from '../../types';
import type { Node } from '@xyflow/react';

// Espacio horizontal entre nodos/chips en la fila del almacén.
const NODE_ITEM_WIDTH = 180;
const NODE_ITEM_GAP = 20;
// Altura fija de las filas (referencial para fitView y chip de arista).
export const STAGING_NODE_ROW_Y = 40;
export const STAGING_EDGE_ROW_Y = 200;

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

// Calcula las posiciones de los chips de arista en la fila inferior del almacén.
// Cada chip es un nodo especial de tipo 'edgeChip' que muestra source→target+label.
// Las aristas REALES de React Flow NO se añaden durante staging.
export function stagingEdgeChipPositions(
    edges: DiagramEdge[],
    nodes: DiagramNode[],
): Node[] {
    const nodeLabel = (id: string) =>
        nodes.find((n) => n.id === id)?.label ?? id;

    return edges.map((edge, index) => ({
        id: `__chip__${edge.id}`,
        position: {
            x: index * (NODE_ITEM_WIDTH + NODE_ITEM_GAP),
            y: STAGING_EDGE_ROW_Y,
        },
        data: {
            sourceLabel: nodeLabel(edge.source),
            targetLabel: nodeLabel(edge.target),
            edgeLabel: edge.label,
        },
        draggable: false,
        type: 'edgeChip',
        // Evita que React Flow intente resolver handles de conexión para estos chips.
        connectable: false,
    }));
}
