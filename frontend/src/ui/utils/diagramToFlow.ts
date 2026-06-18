import type { DiagramSchema, DiagramType, NodeType } from "../../types";
import '@xyflow/react/dist/style.css';
import type { Node, Edge } from "@xyflow/react";
import dagre from '@dagrejs/dagre';
import { sequenceLayout } from './sequenceLayout';
import { mindmapLayout } from './mindmapLayout';
import { architectureLayoutSync } from './architectureLayout';
import { defaultEdgeShape, edgeTypeStyle } from './edgeDefaults';
import { routeOrthogonal, simpleZClear, type Rect, type Side as RouteSide } from './orthogonalRoute';

const nodeTypeMap: Partial<Record<NodeType, string>> = {
    person: 'archIcon',
    container: 'archIcon',
    component: 'archIcon',
    gateway: 'archIcon',
    service: 'archIcon',
    database: 'archIcon',
    queue: 'archIcon',
    actor: 'sequenceActor',
    step: 'flow',
    decision: 'flow',
    terminator: 'flow',
    table: 'table',
    topic: 'mindmap',
    use_case: 'useCase',
};

// Overrides específicos por diagram_type para node_types que comparten nombre entre
// diagramas pero necesitan componentes distintos.
// En use_case: actor → useCaseActor (monigote lateral); system → useCaseSystem (caja subsistema).
const nodeTypeOverrides: Partial<Record<DiagramType, Partial<Record<NodeType, string>>>> = {
    use_case: {
        actor: 'useCaseActor',
        system: 'useCaseSystem',
    },
};

// Estima el tamaño renderizado de un nodo a partir de su contenido para alimentar
// a dagre. Aproxima el TableNode/UmlClassNode: cabecera + una fila por atributo,
// con fuente monoespaciada (~7.3px por carácter). Los valores son holgados a
// propósito; es mejor sobreestimar (más aire) que solapar.
export function estimateNodeSize(label: string, attributes?: string[]): { width: number, height: number } {
    const attrs = attributes ?? [];
    const longest = Math.max(label.length, ...attrs.map((a) => a.length), 0);
    // padding lateral (24) + hueco para el icono PK/FK (~18) + ancho del texto.
    const width = Math.max(180, Math.round(longest * 7.3) + 48);
    // cabecera (~40) + padding del cuerpo (~16) + ~22px por fila de atributo.
    const HEADER = 40;
    const BODY_PADDING = 16;
    const ROW = 22;
    const height = HEADER + BODY_PADDING + attrs.length * ROW;
    return { width, height };
}

export type Box = { cx: number; cy: number; w: number; h: number };
type Side = 'T' | 'B' | 'L' | 'R';
type Anchor = { x: number; y: number };

// Eje de conexión de la arista: el lado por el que hay hueco entre las cajas. Si
// comparten rango en X (apiladas) → vertical; si comparten en Y (en fila) →
// horizontal; en diagonal, el eje con mayor separación. Decidir UN eje para toda la
// arista (y asignar lados opuestos a cada extremo) evita codos absurdos como salir
// por la derecha y entrar por arriba.
function edgeAxis(a: Box, b: Box): 'V' | 'H' {
    const aL = a.cx - a.w / 2, aR = a.cx + a.w / 2, aT = a.cy - a.h / 2, aB = a.cy + a.h / 2;
    const bL = b.cx - b.w / 2, bR = b.cx + b.w / 2, bT = b.cy - b.h / 2, bB = b.cy + b.h / 2;
    const overlapX = Math.min(aR, bR) - Math.max(aL, bL);
    const overlapY = Math.min(aB, bB) - Math.max(aT, bT);
    if (overlapX > 0 && overlapY > 0) {
        // Cajas solapadas (raro): decidir por delta de centros.
        return Math.abs(b.cx - a.cx) >= Math.abs(b.cy - a.cy) ? 'H' : 'V';
    }
    if (overlapX > 0) return 'V'; // comparten X → conectar arriba/abajo
    if (overlapY > 0) return 'H'; // comparten Y → conectar izquierda/derecha
    // Diagonal: el eje con mayor hueco entre cajas.
    const gapX = Math.max(aL, bL) - Math.min(aR, bR);
    const gapY = Math.max(aT, bT) - Math.min(aB, bB);
    return gapY >= gapX ? 'V' : 'H';
}

const opposite: Record<Side, Side> = { T: 'B', B: 'T', L: 'R', R: 'L' };

// Lados de origen y destino de la arista, sobre un único eje y enfrentados.
function edgeSides(src: Box, tgt: Box): { src: Side; tgt: Side } {
    const axis = edgeAxis(src, tgt);
    const srcSide: Side = axis === 'V'
        ? (tgt.cy > src.cy ? 'B' : 'T')
        : (tgt.cx > src.cx ? 'R' : 'L');
    return { src: srcSide, tgt: opposite[srcSide] };
}

function anchorFor(side: Side, t: number): Anchor {
    switch (side) {
        case 'T': return { x: t, y: 0 };
        case 'B': return { x: t, y: 1 };
        case 'L': return { x: 0, y: t };
        default: return { x: 1, y: t };
    }
}

function sideOfAnchor(a: Anchor): Side {
    if (a.x <= 0) return 'L';
    if (a.x >= 1) return 'R';
    if (a.y <= 0) return 'T';
    return 'B';
}

// Punto absoluto en coordenadas de flujo a partir de un anclaje normalizado y la caja.
function anchorToAbs(box: Box, a: Anchor): { x: number; y: number } {
    return { x: box.cx - box.w / 2 + a.x * box.w, y: box.cy - box.h / 2 + a.y * box.h };
}

// Margen mínimo del anclaje a la esquina del lado (px de flujo).
const ANCHOR_PAD = 16;
// Separación mínima entre anclajes que comparten lado (px de flujo).
const ANCHOR_MIN_SEP = 26;

// Coloca cada valor (ya ordenado) lo más cerca posible de su `desired`, garantizando
// una separación mínima `sep` y manteniéndolos dentro de [lo, hi]. Si no caben con la
// separación pedida, los reparte uniformemente por el lado.
function spreadAlong(desired: number[], sep: number, lo: number, hi: number): number[] {
    const n = desired.length;
    if (n === 0) return [];
    if (n === 1) return [Math.max(lo, Math.min(hi, desired[0]))];
    if ((n - 1) * sep >= hi - lo) {
        // No hay sitio para `sep`: reparto uniforme en todo el lado.
        return desired.map((_, i) => lo + ((hi - lo) * i) / (n - 1));
    }
    const pos = desired.map((v) => Math.max(lo, Math.min(hi, v)));
    // Pasada hacia delante: empuja a la derecha lo que se solape.
    for (let i = 1; i < n; i++) if (pos[i] < pos[i - 1] + sep) pos[i] = pos[i - 1] + sep;
    // Si se sale por la derecha, desplaza todo el bloque a la izquierda.
    if (pos[n - 1] > hi) {
        const shift = pos[n - 1] - hi;
        for (let i = 0; i < n; i++) pos[i] -= shift;
    }
    // Garantía final dentro del rango (el bloque cabe porque (n-1)*sep < hi-lo).
    if (pos[0] < lo) {
        const shift = lo - pos[0];
        for (let i = 0; i < n; i++) pos[i] += shift;
    }
    return pos;
}

// Para cada arista calcula anclajes de origen/destino en el centro de su lado y,
// cuando varias aristas comparten el mismo lado de un nodo, las reparte a lo largo
// de él (estilo dbdiagram/draw.io) para que conecten a los lados —no a las
// esquinas— y no se solapen. Solo afecta al render por defecto; las ediciones del
// usuario (waypoints/anclajes propios) prevalecen en diagramToFlow.
export type EdgeRouting = { sourceAnchor?: Anchor; targetAnchor?: Anchor; waypoints?: { x: number; y: number }[] };

// Construye las aristas de React Flow a partir del diagrama y el ruteo calculado
// (anclajes + waypoints). El ruteo persistido por el usuario en edge.data gana
// siempre vía el spread final. Compartido por el layout inicial (cajas estimadas) y
// el refinamiento con cajas medidas en DiagramCanvas.
export function buildFlowEdges(
    diagram: DiagramSchema,
    anchors: Map<string, EdgeRouting>,
): Edge[] {
    return diagram.edges.map((edge) => {
        const auto = anchors.get(edge.id);

        // Defaults visuales según semántica de edge_type (solo rellenan lo que el
        // usuario no ha fijado todavía). El estilo lo decide la fuente única
        // edgeTypeStyle (compartida con el panel de edición); aquí solo añadimos las
        // etiquetas «include»/«extend» por defecto, que son contenido inicial, no
        // estilo, y por tanto no viven en edgeTypeStyle.
        const typeDefaults: Partial<typeof edge.data> = edgeTypeStyle(edge.edge_type, diagram.diagram_type);
        if (edge.edge_type === 'include') typeDefaults.label = edge.label || '«include»';
        if (edge.edge_type === 'extend')  typeDefaults.label = edge.label || '«extend»';

        return {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            sourceHandle: edge.sourceHandle ?? null,
            targetHandle: edge.targetHandle ?? null,
            data: {
                label: edge.label ?? '',
                shape: defaultEdgeShape(diagram.diagram_type),
                ...(auto ?? {}),
                // typeDefaults solo rellena lo que el usuario no ha fijado todavía.
                ...typeDefaults,
                ...(edge.data ?? {}),
            },
            type: 'default',
        } as Edge;
    });
}

export function computeDistributedAnchors(
    diagram: DiagramSchema,
    boxes: Map<string, Box>,
    // Nodos que NO deben actuar como obstáculos del ruteo (cajas contenedoras como
    // el «system» de casos de uso o los grupos de arquitectura): las aristas tienen
    // que poder cruzar su frontera para alcanzar a los hijos que viven dentro.
    containerIds?: Set<string>,
    // Cajas de OBSTÁCULO alternativas (footprint completo) usadas SOLO para esquivar
    // nodos al rutear. La colocación de anclajes y la elección de lado siguen usando
    // `boxes` (la caja de la forma real, p. ej. el icono 72×72 de archIcon) para que
    // el extremo aterrice SOBRE el nodo y la flecha apunte bien; el footprint solo
    // amplía el área que las líneas deben rodear (p. ej. el texto bajo el icono).
    obstacleBoxes?: Map<string, Box>,
): Map<string, EdgeRouting> {
    // `desired` = coordenada absoluta a lo largo del lado donde el anclaje quiere
    // estar para que la arista salga recta: el centro del solape perpendicular entre
    // las dos cajas (ambos extremos comparten esa coordenada → línea recta) o, si no
    // hay solape, la proyección hacia el otro nodo.
    type Endpoint = { edgeId: string; role: 'source' | 'target'; desired: number };
    const groups = new Map<string, Endpoint[]>();
    const push = (nodeId: string, side: Side, ep: Endpoint) => {
        const key = `${nodeId}|${side}`;
        const list = groups.get(key);
        if (list) list.push(ep); else groups.set(key, [ep]);
    };

    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

    for (const edge of diagram.edges) {
        if (edge.source === edge.target) continue; // bucles: dejar flotante
        const s = boxes.get(edge.source);
        const t = boxes.get(edge.target);
        if (!s || !t) continue;
        const sides = edgeSides(s, t);
        const vertical = sides.src === 'T' || sides.src === 'B';

        let srcDesired: number;
        let tgtDesired: number;
        if (vertical) {
            // Eje perpendicular = X. Solape de los rangos X de ambas cajas.
            const lo = Math.max(s.cx - s.w / 2, t.cx - t.w / 2) + ANCHOR_PAD;
            const hi = Math.min(s.cx + s.w / 2, t.cx + t.w / 2) - ANCHOR_PAD;
            if (lo <= hi) {
                const shared = clamp((s.cx + t.cx) / 2, lo, hi); // misma X → recta
                srcDesired = shared; tgtDesired = shared;
            } else {
                srcDesired = clamp(t.cx, s.cx - s.w / 2 + ANCHOR_PAD, s.cx + s.w / 2 - ANCHOR_PAD);
                tgtDesired = clamp(s.cx, t.cx - t.w / 2 + ANCHOR_PAD, t.cx + t.w / 2 - ANCHOR_PAD);
            }
        } else {
            // Eje perpendicular = Y.
            const lo = Math.max(s.cy - s.h / 2, t.cy - t.h / 2) + ANCHOR_PAD;
            const hi = Math.min(s.cy + s.h / 2, t.cy + t.h / 2) - ANCHOR_PAD;
            if (lo <= hi) {
                const shared = clamp((s.cy + t.cy) / 2, lo, hi);
                srcDesired = shared; tgtDesired = shared;
            } else {
                srcDesired = clamp(t.cy, s.cy - s.h / 2 + ANCHOR_PAD, s.cy + s.h / 2 - ANCHOR_PAD);
                tgtDesired = clamp(s.cy, t.cy - t.h / 2 + ANCHOR_PAD, t.cy + t.h / 2 - ANCHOR_PAD);
            }
        }
        push(edge.source, sides.src, { edgeId: edge.id, role: 'source', desired: srcDesired });
        push(edge.target, sides.tgt, { edgeId: edge.id, role: 'target', desired: tgtDesired });
    }

    const result = new Map<string, { sourceAnchor?: Anchor; targetAnchor?: Anchor; waypoints?: { x: number; y: number }[] }>();
    for (const [key, eps] of groups) {
        const nodeId = key.slice(0, -2);
        const side = key.slice(-1) as Side;
        const box = boxes.get(nodeId)!;
        const vertical = side === 'T' || side === 'B';
        const lo = (vertical ? box.cx - box.w / 2 : box.cy - box.h / 2) + ANCHOR_PAD;
        const hi = (vertical ? box.cx + box.w / 2 : box.cy + box.h / 2) - ANCHOR_PAD;

        // Coloca cada anclaje en su `desired` y, si varios quedan demasiado juntos,
        // los separa (manteniéndolos dentro del lado). Una sola arista → se queda en
        // su desired exacto (línea recta).
        eps.sort((a, b) => a.desired - b.desired);
        const positions = spreadAlong(eps.map((e) => e.desired), ANCHOR_MIN_SEP, lo, hi);
        eps.forEach((ep, i) => {
            const coord = positions[i];
            const tNorm = vertical
                ? (coord - (box.cx - box.w / 2)) / box.w
                : (coord - (box.cy - box.h / 2)) / box.h;
            const anchor = anchorFor(side, clamp(tNorm, 0.05, 0.95));
            const entry = result.get(ep.edgeId) ?? {};
            if (ep.role === 'source') entry.sourceAnchor = anchor;
            else entry.targetAnchor = anchor;
            result.set(ep.edgeId, entry);
        });
    }

    // Pasada de ruteo ortogonal: para cada arista, calcula waypoints que rodean los
    // demás nodos en lugar de atravesarlos. Las cajas (Rect) se reutilizan por
    // identidad para excluir los nodos origen/destino como obstáculos.
    // Los obstáculos usan el footprint (texto incluido) cuando se proporciona, así
    // las líneas rodean también el texto; los extremos siguen anclados sobre `boxes`.
    const obstacles = obstacleBoxes ?? boxes;
    const rects = new Map<string, Rect>();
    for (const [id, b] of obstacles) rects.set(id, { x: b.cx - b.w / 2, y: b.cy - b.h / 2, w: b.w, h: b.h });
    // Los contenedores se excluyen del conjunto de obstáculos (sus hijos sí cuentan).
    const allRects = [...rects.entries()]
        .filter(([id]) => !containerIds?.has(id))
        .map(([, r]) => r);

    for (const edge of diagram.edges) {
        if (edge.source === edge.target) continue;
        const entry = result.get(edge.id);
        const srcBox = boxes.get(edge.source);
        const tgtBox = boxes.get(edge.target);
        const srcRect = rects.get(edge.source);
        const tgtRect = rects.get(edge.target);
        if (!entry?.sourceAnchor || !entry?.targetAnchor || !srcBox || !tgtBox || !srcRect || !tgtRect) continue;

        const start = anchorToAbs(srcBox, entry.sourceAnchor);
        const end = anchorToAbs(tgtBox, entry.targetAnchor);
        const sSide = sideOfAnchor(entry.sourceAnchor) as RouteSide;
        const tSide = sideOfAnchor(entry.targetAnchor) as RouteSide;

        // Si la Z simple y centrada llega sin tocar ningún nodo, no añadimos
        // waypoints: el renderer dibuja una Z limpia (sin escaloncitos). Solo
        // recurrimos al A* cuando esa Z chocaría con algún nodo.
        if (simpleZClear(start, sSide, end, tSide, allRects, srcRect, tgtRect)) continue;

        const route = routeOrthogonal(
            start, sSide, end, tSide,
            allRects, srcRect, tgtRect,
        );
        // route incluye [start, …, end]; los waypoints son los puntos intermedios.
        if (route && route.length > 2) entry.waypoints = route.slice(1, -1);
    }

    return result;
}

// Layout para diagramas de casos de uso UML.
// Estrategia: actores a los lados (izquierda/derecha alternando), casos de uso
// centrados con dagre en orientación LR, nodos «system» como grupos contenedores
// (extensión de la raíz del dagre, dimensionados para envolver sus hijos).
function useCaseLayout(diagram: DiagramSchema): { nodes: Node[], edges: Edge[] } {
    // Separar actores, casos de uso y la caja system (si existe).
    const actors   = diagram.nodes.filter((n) => n.node_type === 'actor');
    const useCases = diagram.nodes.filter((n) => n.node_type === 'use_case');
    const systems  = diagram.nodes.filter((n) => n.node_type === 'system');

    // Tamaño fijo para los nodos del layout (en px de flujo).
    const ACTOR_W    = 80;
    const ACTOR_H    = 100; // monigote + etiqueta
    const UC_W       = 160;
    const UC_H       = 60;
    const UC_GAP_X   = 40;
    const UC_GAP_Y   = 40;
    const SIDE_PAD   = 60;  // espacio desde el borde del «system» hasta el primer actor
    const GROUP_PAD  = 60;  // relleno interior de la caja system

    // Layout de los casos de uso: cuadrícula centrada.
    // Número de columnas: raíz cuadrada redondeada al alza (cuadrícula lo más cuadrada posible).
    const cols = Math.max(1, Math.ceil(Math.sqrt(useCases.length)));
    const ucPositions: { id: string; x: number; y: number }[] = useCases.map((uc, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        return {
            id: uc.id,
            x: GROUP_PAD + col * (UC_W + UC_GAP_X),
            y: GROUP_PAD + 36 + row * (UC_H + UC_GAP_Y), // 36px para la etiqueta del system
        };
    });

    // Dimensiones del área de casos de uso (interior de la caja system).
    const rows     = Math.ceil(useCases.length / cols);
    const innerW   = cols * UC_W + (cols - 1) * UC_GAP_X + GROUP_PAD * 2;
    const innerH   = rows * UC_H + (rows - 1) * UC_GAP_Y + GROUP_PAD * 2 + 36;

    // Posición de la caja system (origen 0,0).
    const sysX = ACTOR_W + SIDE_PAD;
    const sysY = 0;

    // Actores: mitad a la izquierda, mitad a la derecha, distribuidos verticalmente.
    const leftActors  = actors.filter((_, i) => i % 2 === 0);
    const rightActors = actors.filter((_, i) => i % 2 === 1);
    const actorSpacingY = Math.max(UC_H + UC_GAP_Y, innerH / Math.max(leftActors.length, 1));

    const actorNodes: Node[] = actors.map((actor, globalIdx) => {
        const isLeft   = globalIdx % 2 === 0;
        const localIdx = Math.floor(globalIdx / 2);
        const groupLen = isLeft ? leftActors.length : rightActors.length;
        const totalH   = groupLen * actorSpacingY - UC_GAP_Y;
        const startY   = sysY + (innerH - totalH) / 2;
        const ax = isLeft
            ? sysX - SIDE_PAD - ACTOR_W
            : sysX + innerW + SIDE_PAD;
        const ay = (actor.position)
            ? actor.position.y
            : startY + localIdx * actorSpacingY;
        return {
            id: actor.id,
            position: { x: actor.position ? actor.position.x : ax, y: ay },
            data: { label: actor.label, nodeType: actor.node_type, attributes: actor.attributes },
            type: 'useCaseActor',
        } as Node;
    });

    // Nodo(s) system como contenedor (parentId no soportado en todos los layouts;
    // aquí usamos posición absoluta con dimensiones ajustadas).
    const systemNodes: Node[] = systems.map((sys) => ({
        id: sys.id,
        position: sys.position ?? { x: sysX, y: sysY },
        data: { label: sys.label, nodeType: sys.node_type, attributes: sys.attributes },
        type: 'useCaseSystem',
        style: { width: innerW, height: innerH },
        // Nodo contenedor: no tiene handles propios.
    } as Node));

    // Nodos de casos de uso: posición relativa al system (absoluta en el canvas).
    const ucNodes: Node[] = useCases.map((uc) => {
        const pos = ucPositions.find((p) => p.id === uc.id)!;
        return {
            id: uc.id,
            position: uc.position ?? { x: sysX + pos.x, y: sysY + pos.y },
            data: { label: uc.label, nodeType: uc.node_type, attributes: uc.attributes },
            type: 'useCase',
        } as Node;
    });

    // Todos los nodos en orden: system primero (se renderiza detrás).
    const allNodes = [...systemNodes, ...actorNodes, ...ucNodes];

    // Cajas para el ruteo de aristas.
    const boxes = new Map<string, { cx: number; cy: number; w: number; h: number }>();
    for (const n of allNodes) {
        const w = (n.style as { width?: number } | undefined)?.width ?? (n.type === 'useCaseActor' ? ACTOR_W : UC_W);
        const h = (n.style as { height?: number } | undefined)?.height ?? (n.type === 'useCaseActor' ? ACTOR_H : UC_H);
        boxes.set(n.id, { cx: n.position.x + w / 2, cy: n.position.y + h / 2, w, h });
    }

    // La caja «system» no es obstáculo: las aristas actor→caso-de-uso deben cruzar
    // su frontera para alcanzar los casos de uso que viven dentro.
    const containerIds = new Set(systemNodes.map((n) => n.id));
    const anchors = computeDistributedAnchors(diagram, boxes, containerIds);
    const edges   = buildFlowEdges(diagram, anchors);

    return { nodes: allNodes, edges };
}

// Resuelve el componente React Flow (`type`) de un nodo del dominio: override por
// diagram_type → mapa general → 'default'. Compartido por dagreLayout y el layout
// en vivo, que coloca nodos sin conocer aún el diagram_type definitivo.
export function flowNodeType(nodeType: NodeType, diagramType: DiagramType | null | undefined): string {
    return (diagramType ? nodeTypeOverrides[diagramType]?.[nodeType] : undefined)
        ?? nodeTypeMap[nodeType]
        ?? 'default';
}

export function DiagramToFlow(diagram: DiagramSchema): { nodes: Node[], edges: Edge[] } {
    if (diagram.diagram_type === 'sequence') {
        return sequenceLayout(diagram);
    }
    if (diagram.diagram_type === 'mindmap') {
        return mindmapLayout(diagram);
    }
    if (diagram.diagram_type === 'architecture') {
        return architectureLayoutSync(diagram);
    }
    if (diagram.diagram_type === 'use_case') {
        return useCaseLayout(diagram);
    }

    return dagreLayout(diagram);
}

// Layout jerárquico genérico con dagre (ERD, clases, flujo y, en general, cualquier
// diagrama sin layout propio). Extraído de DiagramToFlow para reutilizarlo en el
// montaje en vivo en cuanto llega la primera arista, sin depender del
// diagram_type (que durante el streaming todavía es null).
export function dagreLayout(diagram: DiagramSchema): { nodes: Node[], edges: Edge[] } {
    const graph = new dagre.graphlib.Graph();

    const rankdir = 'TB';

    // Separación generosa entre nodos (nodesep) y entre rangos (ranksep) para que
    // las tablas/clases no queden pegadas y haya espacio para las etiquetas de las
    // aristas. marginx/y añade un margen alrededor de todo el grafo.
    graph.setGraph({ rankdir, nodesep: 120, ranksep: 150, marginx: 40, marginy: 40 });
    graph.setDefaultEdgeLabel(() => ({}));

    diagram.nodes.forEach( (node) => {
        // Dagre necesita el tamaño real del nodo para no solaparlos. Las tablas/clases
        // crecen con sus atributos, así que estimamos ancho y alto a partir del contenido
        // en lugar de un 150x50 fijo (que provocaba solapamientos verticales).
        const { width, height } = estimateNodeSize(node.label, node.attributes);
        graph.setNode(node.id, { label: node.label, width, height });
    });

    diagram.edges.forEach( (edge) => {
        // Reservamos espacio para la etiqueta entre rangos para que dagre no la
        // solape con los nodos ni con otras aristas.
        const label = edge.label ?? '';
        graph.setEdge(edge.source, edge.target, {
            label,
            width: label ? label.length * 7 + 24 : 0,
            height: label ? 28 : 0,
            labelpos: 'c',
        });
    });

    dagre.layout(graph);

    // Caja (centro + dimensiones) de cada nodo en coordenadas de flujo, respetando
    // la posición guardada por el usuario. Es la base para repartir los anclajes de
    // las aristas por los lados de los nodos.
    const boxes = new Map<string, { cx: number; cy: number; w: number; h: number }>();
    diagram.nodes.forEach((node) => {
        const g = graph.node(node.id);
        const w = g.width;
        const h = g.height;
        if (node.position) {
            boxes.set(node.id, { cx: node.position.x + w / 2, cy: node.position.y + h / 2, w, h });
        } else {
            boxes.set(node.id, { cx: g.x, cy: g.y, w, h });
        }
    });

    const anchors = computeDistributedAnchors(diagram, boxes);

    const nodes = diagram.nodes.map( (node) => {
        // Si el nodo tiene posición guardada, respeta la del usuario.
        // Dagre solo actúa como layout inicial cuando no hay posición previa.
        // Dagre devuelve el centro del nodo; React Flow espera la esquina superior
        // izquierda, así que restamos media anchura/altura cuando usamos su layout.
        let x: number;
        let y: number;
        if (node.position) {
            ({ x, y } = node.position);
        } else {
            const g = graph.node(node.id);
            x = g.x - g.width / 2;
            y = g.y - g.height / 2;
        }
        return {
            id: node.id,
            position: { x, y },
            data: {
                label: node.label,
                nodeType: node.node_type,
                attributes: node.attributes,
            },
            type: flowNodeType(node.node_type, diagram.diagram_type)
        } as Node;
    });

    // Aristas con el ruteo inicial (cajas estimadas). DiagramCanvas lo refina con
    // las cajas medidas reales una vez React Flow mide los nodos.
    const edges = buildFlowEdges(diagram, anchors);

    return { nodes, edges };
}