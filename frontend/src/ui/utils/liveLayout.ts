// Layout del montaje EN VIVO del diagrama durante la generación por streaming
// (generationPhase === 'live').
//
// Idea: los nodos van llegando y se colocan en un CÍRCULO RADIAL compacto (que crece
// con el nº de nodos); a medida que llegan las aristas, la estructura real del
// diagrama (mindmap radial, ERD/clases con dagre…) cristaliza en el centro y va
// tirando de los nodos conectados hacia su sitio. Los nodos que aún no tienen ninguna
// arista esperan en un anillo alrededor de la estructura y entran cuando una arista
// los teje. Así se ve construirse conexión a conexión, sin saltos bruscos.
//
// PURA: DiagramCanvas la llama en cada render durante 'live'; el diagrama crece según
// la cola de revelado (useWebSocket) va soltando nodos y aristas con ritmo.

import type { DiagramSchema } from '../../types';
import type { Node, Edge } from '@xyflow/react';
import { DiagramToFlow, estimateNodeSize, flowNodeType } from './diagramToFlow';

const TWO_PI = Math.PI * 2;

// Tamaño del «system» de casos de uso durante el montaje en vivo. El nodo system
// nunca aparece en una arista, así que siempre espera fuera de la estructura; sin un
// tamaño explícito, su CSS width/height:100% lo colapsa a un punto. Le damos un
// cuadrado pequeño para que se lea como una caja en miniatura hasta que el layout
// final (useCaseLayout) lo dimensione para envolver sus casos de uso.
const SYSTEM_LIVE_SIZE = 96;

// Radio del círculo de espera para `n` nodos: compacto, pero crece lo justo para que
// no se solapen (separación ~constante entre nodos contiguos del círculo).
function circleRadius(n: number): number {
    return Math.max(220, Math.round(n * 22));
}

// `n` centros repartidos uniformemente en un círculo (empezando arriba), en torno a
// (cx, cy). Con un solo nodo, el centro mismo.
function circlePoints(n: number, radius: number, cx = 0, cy = 0): { x: number; y: number }[] {
    if (n <= 1) return [{ x: cx, y: cy }];
    return Array.from({ length: n }, (_, i) => {
        const a = -Math.PI / 2 + (TWO_PI * i) / n;
        return { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius };
    });
}

export function liveLayout(diagram: DiagramSchema): { nodes: Node[]; edges: Edge[] } {
    const type = diagram.diagram_type;
    const connected = new Set<string>();
    for (const e of diagram.edges) { connected.add(e.source); connected.add(e.target); }

    // Fase nodos: aún sin conexiones → todos en un círculo radial compacto.
    if (connected.size === 0) {
        const pts = circlePoints(diagram.nodes.length, circleRadius(diagram.nodes.length));
        const nodes = diagram.nodes.map((n, i) => {
            const isSystem = n.node_type === 'system';
            const { width, height } = isSystem
                ? { width: SYSTEM_LIVE_SIZE, height: SYSTEM_LIVE_SIZE }
                : estimateNodeSize(n.label, n.attributes, n.node_type);
            return {
                id: n.id,
                // React Flow espera la esquina superior izquierda → restamos medio nodo.
                position: { x: pts[i].x - width / 2, y: pts[i].y - height / 2 },
                data: { label: n.label, nodeType: n.node_type, attributes: n.attributes },
                type: flowNodeType(n.node_type, type),
                // El system necesita tamaño explícito o colapsa a un punto.
                ...(isSystem ? { style: { width: SYSTEM_LIVE_SIZE, height: SYSTEM_LIVE_SIZE } } : {}),
            } as Node;
        });
        return { nodes, edges: [] };
    }

    // Hay conexiones → layout REAL para la estructura. Los nodos aún sin conectar
    // quedan esperando en un anillo radial alrededor (entran cuando los teje su arista,
    // sin salto: se mantienen en el anillo hasta entonces).
    const real = DiagramToFlow(diagram);
    const unconnected = diagram.nodes.filter((n) => !connected.has(n.id));
    if (unconnected.length === 0) return real;

    // Centro y extensión de la estructura conectada (posiciones de real = esquina
    // superior izquierda; suficiente como aproximación para situar el anillo).
    const connPos = real.nodes.filter((n) => connected.has(n.id)).map((n) => n.position);
    const cx = connPos.reduce((s, p) => s + p.x, 0) / (connPos.length || 1);
    const cy = connPos.reduce((s, p) => s + p.y, 0) / (connPos.length || 1);
    const maxR = connPos.reduce((m, p) => Math.max(m, Math.hypot(p.x - cx, p.y - cy)), 0);
    const ringR = Math.max(300, maxR + 220);
    const ring = circlePoints(unconnected.length, ringR, cx, cy);
    const ringPos = new Map(unconnected.map((n, i) => [n.id, ring[i]]));

    const nodes = real.nodes.map((n) => {
        const c = ringPos.get(n.id);
        if (!c) return n; // conectado: posición real de la estructura
        const isSystem = n.type === 'useCaseSystem';
        const data = n.data as { label?: string; attributes?: string[] };
        const { width, height } = isSystem
            ? { width: SYSTEM_LIVE_SIZE, height: SYSTEM_LIVE_SIZE }
            : estimateNodeSize(data?.label ?? '', data?.attributes);
        return {
            ...n,
            position: { x: c.x - width / 2, y: c.y - height / 2 },
            // En vivo el system se muestra como cuadrado pequeño, no a tamaño completo.
            ...(isSystem ? { style: { width: SYSTEM_LIVE_SIZE, height: SYSTEM_LIVE_SIZE } } : {}),
        };
    });
    return { nodes, edges: real.edges };
}
