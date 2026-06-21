import type { DiagramSchema, DiagramType, NodeType } from "../../types";
import '@xyflow/react/dist/style.css';
import type { Node, Edge } from "@xyflow/react";
import dagre from '@dagrejs/dagre';
import { sequenceLayout } from './sequenceLayout';
import { mindmapLayout } from './mindmapLayout';
import { architectureLayoutSync } from './architectureLayout';
import { defaultEdgeShape, edgeTypeStyle } from './edgeDefaults';
import { routeOrthogonal, simpleZClear, type Rect, type Side as RouteSide } from './orthogonalRoute';
import { decisionNodeSize } from './decisionNode';

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
export function estimateNodeSize(label: string, attributes?: string[], nodeType?: NodeType): { width: number, height: number } {
    // Nodos de FLUJO: cajas pequeñas con texto proporcional (no la rejilla
    // monoespaciada de tablas/clases). Estimamos su tamaño RENDERIZADO real para
    // que dagre centre la cadena correctamente: si sobreestimamos el ancho (como
    // hacía el cálculo de tablas, mínimo 180), dagre reserva de más y el nodo, ya
    // medido a su tamaño real, queda descentrado del eje → las flechas se tuercen.
    //
    //  - decision: rombo (misma fuente que FlowNode → coincidencia exacta).
    //  - terminator: píldora con padding px-6 (48) + borde 6.
    //  - step: rectángulo de proceso con padding px-4 (32) + borde 6.
    if (nodeType === 'decision') {
        const { width, height } = decisionNodeSize(label);
        return { width, height };
    }
    if (nodeType === 'terminator' || nodeType === 'step') {
        const FLOW_CHAR = 7.4;            // ancho medio por carácter a 14px (text-sm) bold/semibold
        const padX = nodeType === 'terminator' ? 48 : 32; // px-6 vs px-4
        const width = Math.max(72, Math.round(label.length * FLOW_CHAR) + padX + 6);
        return { width, height: 50 };
    }
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

// Ancho máximo del TEXTO de un caso de uso antes de envolver a varias líneas.
// Es la única fuente de verdad del wrap: UseCaseNode lo aplica como max-width (CSS)
// y useCaseNodeSize lo usa para estimar el alto, de modo que el layout dimensiona
// la caja «system» EXACTAMENTE como se renderiza el nodo (sin recortes).
export const USE_CASE_MAX_TEXT_W = 200;

// Tamaño renderizado (caja contenedora) de un caso de uso a partir de su etiqueta,
// replicando el wrap de UseCaseNode: el texto se envuelve a USE_CASE_MAX_TEXT_W y el
// nodo crece en VERTICAL (varias líneas). Es deliberadamente holgado: mejor
// sobreestimar que recortar. El padding es generoso (px-8/py-4) porque en una elipse
// el rectángulo de texto solo cabe si la caja es bastante mayor; así el texto
// multilínea no asoma por las esquinas del óvalo. Chrome lateral = px-8 (64) + borde
// 6; vertical = py-4 (32) + borde 6. Mínimos = min-w-[120]/min-h-[52] del componente.
export function useCaseNodeSize(label: string): { width: number; height: number } {
    const CHAR_W = 7.4;   // ancho medio por glifo a 14px (text-sm) semibold
    const LINE_H = 18;    // 14px * leading-tight (~1.25), redondeado al alza
    const PAD_X  = 70;    // px-8 (64) + borde (6)
    const PAD_Y  = 38;    // py-4 (32) + borde (6)
    const MIN_W  = 120;
    const MIN_H  = 52;
    const lineW = label.length * CHAR_W;
    const textW = Math.min(USE_CASE_MAX_TEXT_W, lineW);
    const lines = Math.max(1, Math.ceil(lineW / USE_CASE_MAX_TEXT_W));
    const width  = Math.max(MIN_W, Math.round(textW) + PAD_X);
    const height = Math.max(MIN_H, lines * LINE_H + PAD_Y);
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
    // Casos de uso UML: las asociaciones actor↔caso se dibujan RECTAS (sin codos ni
    // waypoints), estilo clásico en abanico desde el actor. Las relaciones caso↔caso
    // (include/extend/inherits) conservan su forma por defecto (codo ortogonal).
    const actorIds = diagram.diagram_type === 'use_case'
        ? new Set(diagram.nodes.filter((n) => n.node_type === 'actor').map((n) => n.id))
        : null;

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

        // Asociación actor↔caso: recta y sin waypoints. Mantenemos los anclajes
        // distribuidos (para que cada línea salga de un punto distinto del actor y
        // formen abanico), pero descartamos la ruta ortogonal.
        const isActorAssoc = actorIds !== null
            && (actorIds.has(edge.source) || actorIds.has(edge.target));
        const routing = isActorAssoc && auto
            ? { sourceAnchor: auto.sourceAnchor, targetAnchor: auto.targetAnchor }
            : auto;

        return {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            sourceHandle: edge.sourceHandle ?? null,
            targetHandle: edge.targetHandle ?? null,
            data: {
                label: edge.label ?? '',
                shape: isActorAssoc ? 'straight' : defaultEdgeShape(diagram.diagram_type),
                ...(routing ?? {}),
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

    // En FLUJO queremos que las aristas salgan/entren por el CENTRO del lado del
    // nodo (estilo flowchart clásico): cuando un lado tiene una sola arista la
    // clavamos en el punto medio (0.5) en vez de su `desired`, así la flecha apunta
    // y sale del centro de la arista del nodo aunque los centros no estén alineados.
    const centerSingleSide = diagram.diagram_type === 'flowchart';

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
        const centerThisSide = centerSingleSide && eps.length === 1;
        eps.forEach((ep, i) => {
            const coord = positions[i];
            const tNorm = centerThisSide
                ? 0.5
                : vertical
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
// Estrategia clásica: actores apilados a los lados (centrados respecto a la altura
// del subsistema), casos de uso en 1 o 2 COLUMNAS verticales dentro de la caja
// «system». Una columna para diagramas pequeños; dos a partir de 7 casos, con los
// casos conectados a actores en la columna izquierda (de cara a la actor) y las
// extensiones (solo include/extend entre casos) en la derecha.
function useCaseLayout(diagram: DiagramSchema): { nodes: Node[], edges: Edge[] } {
    // Separar actores, casos de uso y la caja system (si existe).
    const actors   = diagram.nodes.filter((n) => n.node_type === 'actor');
    const useCases = diagram.nodes.filter((n) => n.node_type === 'use_case');
    const systems  = diagram.nodes.filter((n) => n.node_type === 'system');

    // Tamaños fijos para el layout (px de flujo).
    const ACTOR_W    = 80;
    const ACTOR_H    = 110;  // monigote + etiqueta
    const UC_W_MIN   = 170;  // ancho mínimo de columna (los casos cortos no encogen de más)
    const UC_GAP_X   = 110;  // hueco entre columnas: deja sitio a etiquetas «include»/«extend»
    const UC_GAP_Y   = 64;   // hueco vertical entre casos apilados
    const SIDE_PAD   = 96;   // del borde del «system» al actor
    const GROUP_PAD  = 56;   // relleno interior de la caja system
    const LABEL_BAND = 40;   // banda superior reservada al título del subsistema

    // Tamaño RENDERIZADO de cada caso (texto multilínea → crece en vertical). El box
    // se dimensiona a partir de ESTOS tamaños, no de un alto fijo, para envolverlos
    // siempre. Misma regla de wrap que UseCaseNode (useCaseNodeSize comparte el cap).
    const sizeOf = new Map<string, { width: number; height: number }>();
    for (const uc of useCases) sizeOf.set(uc.id, useCaseNodeSize(uc.label));

    const n = useCases.length;
    // 1 columna para diagramas pequeños; 2 columnas a partir de 7 casos.
    const cols = n <= 6 ? 1 : 2;

    // Lado de cada actor (alternando por índice: pares izquierda, impares derecha).
    // Debe coincidir con el reparto leftActors/rightActors de más abajo.
    const sideOf = new Map<string, 'L' | 'R'>();
    actors.forEach((a, i) => sideOf.set(a.id, i % 2 === 0 ? 'L' : 'R'));

    // Tirón lateral de cada caso = nº de actores derechos − nº de actores izquierdos
    // conectados. <0 mira a la izquierda, >0 a la derecha, 0 indeciso (extensión sin
    // actor o equilibrado). Sitúa cada caso en la columna de SU actor → aristas cortas
    // que no cruzan a la otra columna.
    const pull = new Map<string, number>();
    for (const uc of useCases) pull.set(uc.id, 0);
    for (const e of diagram.edges) {
        if (sideOf.has(e.source) && pull.has(e.target)) pull.set(e.target, pull.get(e.target)! + (sideOf.get(e.source) === 'R' ? 1 : -1));
        if (sideOf.has(e.target) && pull.has(e.source)) pull.set(e.source, pull.get(e.source)! + (sideOf.get(e.target) === 'R' ? 1 : -1));
    }

    // Reparto en columnas. Con 1 columna: orden de entrada. Con 2: cada caso a la
    // columna de su actor dominante; los indecisos equilibran. Se descartan columnas
    // vacías (si todo tira a un lado, queda 1 columna).
    let columns: Array<typeof useCases>;
    if (cols === 1) {
        columns = [useCases.slice()];
    } else {
        const left: typeof useCases = [];
        const right: typeof useCases = [];
        const undecided: typeof useCases = [];
        for (const uc of useCases) {
            const p = pull.get(uc.id) ?? 0;
            if (p < 0) left.push(uc);
            else if (p > 0) right.push(uc);
            else undecided.push(uc);
        }
        for (const uc of undecided) (left.length <= right.length ? left : right).push(uc);
        columns = [left, right].filter((c) => c.length > 0);
        if (columns.length === 0) columns = [useCases.slice()];
    }

    // Dentro de cada columna, ordena para que los casos relacionados por include/
    // extend (aristas caso↔caso) queden CONTIGUOS → la relación es una línea corta sin
    // saltos. DFS sembrado por el orden de entrada: emite un caso e inmediatamente sus
    // vecinos de la misma columna aún no emitidos.
    const ucIds = new Set(useCases.map((u) => u.id));
    const ucAdj = new Map<string, string[]>();
    for (const u of useCases) ucAdj.set(u.id, []);
    for (const e of diagram.edges) {
        if (e.source !== e.target && ucIds.has(e.source) && ucIds.has(e.target)) {
            ucAdj.get(e.source)!.push(e.target);
            ucAdj.get(e.target)!.push(e.source);
        }
    }
    columns = columns.map((items) => {
        const idx = new Map(items.map((it, i) => [it.id, i]));
        const emitted = new Set<string>();
        const out: typeof items = [];
        const visit = (it: (typeof useCases)[number]) => {
            if (emitted.has(it.id)) return;
            emitted.add(it.id);
            out.push(it);
            (ucAdj.get(it.id) ?? [])
                .filter((id) => idx.has(id) && !emitted.has(id))
                .sort((a, b) => idx.get(a)! - idx.get(b)!)
                .forEach((id) => visit(items[idx.get(id)!]));
        };
        for (const it of items) visit(it);
        return out;
    });

    const effCols = columns.length;

    // Ancho de cada columna = el caso más ancho que contiene (mínimo UC_W_MIN). Alto
    // de cada columna = suma de los altos reales de sus casos + huecos. El contenido
    // se mide así, con tamaños por nodo, en vez de con una rejilla uniforme.
    const colW = columns.map((col) => Math.max(UC_W_MIN, ...col.map((uc) => sizeOf.get(uc.id)!.width)));
    const colH = columns.map((col) =>
        col.reduce((s, uc) => s + sizeOf.get(uc.id)!.height, 0) + Math.max(0, col.length - 1) * UC_GAP_Y);
    const contentW = colW.reduce((s, w) => s + w, 0) + Math.max(0, effCols - 1) * UC_GAP_X;
    const contentH = Math.max(0, ...colH);
    const innerW   = contentW + GROUP_PAD * 2;
    const innerH   = contentH + GROUP_PAD * 2 + LABEL_BAND;

    // Posición de la caja system (origen 0,0).
    const sysX = ACTOR_W + SIDE_PAD;
    const sysY = 0;
    const contentTop = sysY + GROUP_PAD + LABEL_BAND;

    // x acumulada de cada columna (anchos variables → no es un paso constante).
    const colX: number[] = [];
    for (let c = 0, x = sysX + GROUP_PAD; c < effCols; x += colW[c] + UC_GAP_X, c++) colX.push(x);

    // Posiciones de los casos: cada columna centrada verticalmente en el contenido;
    // cada caso centrado horizontalmente en el ancho de su columna. Se apilan por su
    // alto REAL, así un caso multilínea empuja a los de debajo sin solaparse.
    const ucPos = new Map<string, { x: number; y: number }>();
    columns.forEach((colItems, col) => {
        let y = contentTop + (contentH - colH[col]) / 2;
        for (const uc of colItems) {
            const s = sizeOf.get(uc.id)!;
            ucPos.set(uc.id, { x: colX[col] + (colW[col] - s.width) / 2, y });
            y += s.height + UC_GAP_Y;
        }
    });

    // Actores: mitad izquierda / mitad derecha (alternando por índice), repartidos
    // uniformemente y CENTRADOS respecto a la altura del system (innerH). Un solo
    // actor por lado queda exactamente a media altura.
    const leftActors  = actors.filter((_, i) => i % 2 === 0);
    const rightActors = actors.filter((_, i) => i % 2 === 1);
    const actorY = (idx: number, count: number) =>
        sysY + (innerH * (idx + 1)) / (count + 1) - ACTOR_H / 2;

    const actorNodes: Node[] = actors.map((actor, globalIdx) => {
        const isLeft   = globalIdx % 2 === 0;
        const side     = isLeft ? leftActors : rightActors;
        const localIdx = side.findIndex((a) => a.id === actor.id);
        const ax = isLeft ? sysX - SIDE_PAD - ACTOR_W : sysX + innerW + SIDE_PAD;
        const ay = actorY(localIdx, side.length);
        return {
            id: actor.id,
            position: actor.position ?? { x: ax, y: ay },
            data: { label: actor.label, nodeType: actor.node_type, attributes: actor.attributes },
            type: 'useCaseActor',
        } as Node;
    });

    // Posición final de cada caso (respeta el arrastre manual del propio caso).
    const ucFinal = new Map<string, { x: number; y: number }>();
    for (const uc of useCases) ucFinal.set(uc.id, uc.position ?? ucPos.get(uc.id)!);

    // Región que la caja DEBE cubrir: parte de la geometría automática y se expande
    // hasta envolver el rectángulo REAL de cada caso (con su tamaño medido) más el
    // relleno; LABEL_BAND extra por arriba para el título. Así ningún caso queda
    // fuera, ni siquiera si se arrastró o creció en multilínea.
    let aL = sysX, aT = sysY, aR = sysX + innerW, aB = sysY + innerH;
    for (const uc of useCases) {
        const p = ucFinal.get(uc.id)!;
        const s = sizeOf.get(uc.id)!;
        aL = Math.min(aL, p.x - GROUP_PAD);
        aT = Math.min(aT, p.y - GROUP_PAD - LABEL_BAND);
        aR = Math.max(aR, p.x + s.width + GROUP_PAD);
        aB = Math.max(aB, p.y + s.height + GROUP_PAD);
    }
    const autoX = aL, autoY = aT, autoW = aR - aL, autoH = aB - aT;

    // Nodo(s) system como contenedor (parentId no soportado en todos los layouts;
    // aquí usamos posición absoluta con dimensiones ajustadas).
    const systemNodes: Node[] = systems.map((sys) => {
        // Override manual: si el usuario redimensionó/movió el subsistema, puede
        // AGRANDARLO o MOVERLO, pero el auto-size es un SUELO: la caja nunca encoge
        // por debajo de lo que hace falta para contener todos los casos (se expande
        // para cubrir la región automática). Así no los corta nunca.
        const ov = diagram.group_layout?.[sys.id];
        let x = autoX, y = autoY, width = autoW, height = autoH;
        if (ov) {
            x = Math.min(ov.x, autoX);
            y = Math.min(ov.y, autoY);
            width  = Math.max(ov.x + ov.width,  autoX + autoW) - x;
            height = Math.max(ov.y + ov.height, autoY + autoH) - y;
        }
        return {
            id: sys.id,
            position: { x, y },
            data: { label: sys.label, nodeType: sys.node_type, attributes: sys.attributes },
            type: 'useCaseSystem',
            style: { width, height },
            // Nodo contenedor: no tiene handles propios.
        } as Node;
    });

    // Nodos de casos de uso: posición absoluta en el canvas.
    const ucNodes: Node[] = useCases.map((uc) => ({
        id: uc.id,
        position: ucFinal.get(uc.id)!,
        data: { label: uc.label, nodeType: uc.node_type, attributes: uc.attributes },
        type: 'useCase',
    } as Node));

    // Todos los nodos en orden: system primero (se renderiza detrás).
    const allNodes = [...systemNodes, ...actorNodes, ...ucNodes];

    // Cajas para el ruteo de aristas: system desde su style; actores fijos; casos
    // con su tamaño real medido (sizeOf), para que las flechas apunten bien aunque
    // el caso haya crecido en multilínea.
    const boxes = new Map<string, { cx: number; cy: number; w: number; h: number }>();
    for (const n of allNodes) {
        const s = sizeOf.get(n.id);
        const w = (n.style as { width?: number } | undefined)?.width ?? s?.width ?? (n.type === 'useCaseActor' ? ACTOR_W : UC_W_MIN);
        const h = (n.style as { height?: number } | undefined)?.height ?? s?.height ?? (n.type === 'useCaseActor' ? ACTOR_H : 52);
        boxes.set(n.id, { cx: n.position.x + w / 2, cy: n.position.y + h / 2, w, h });
    }

    // La caja «system» no es obstáculo: las aristas actor→caso-de-uso deben cruzar
    // su frontera para alcanzar los casos de uso que viven dentro.
    const containerIds = new Set(systemNodes.map((n) => n.id));
    const anchors = computeDistributedAnchors(diagram, boxes, containerIds);
    const edges   = buildFlowEdges(diagram, anchors);

    return { nodes: allNodes, edges };
}

// Tipos de nodo (React Flow `type`) que muestran atributos y entran en edición
// INLINE (nombre + atributos en el propio nodo) al hacer doble clic: la tabla ERD
// (lista completa de columnas) y los nodos de arquitectura (icono + línea `tech:`).
// `architecture`/`c4` son legacy —hoy arquitectura siempre renderiza como
// `archIcon`— pero se incluyen por consistencia. Fuente única: la consumen los
// propios nodos y el menú contextual ("Editar").
export const ATTRIBUTE_FLOW_TYPES = new Set(['table', 'archIcon', 'architecture', 'c4']);

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

    // Separación entre nodos (nodesep) y entre rangos (ranksep). Generosa para
    // tablas/clases (ERD), donde las cajas son grandes y las etiquetas de arista
    // necesitan aire. En FLUJO los nodos son pequeños y la cadena es lineal, así
    // que apretamos el avance entre rangos para que no queden tan separados.
    const isFlow = diagram.diagram_type === 'flowchart';
    graph.setGraph({
        rankdir,
        nodesep: isFlow ? 70 : 120,
        ranksep: isFlow ? 80 : 150,
        marginx: 40,
        marginy: 40,
    });
    graph.setDefaultEdgeLabel(() => ({}));

    diagram.nodes.forEach( (node) => {
        // Dagre necesita el tamaño real del nodo para no solaparlos. Las tablas/clases
        // crecen con sus atributos, así que estimamos ancho y alto a partir del contenido
        // en lugar de un 150x50 fijo (que provocaba solapamientos verticales).
        const { width, height } = estimateNodeSize(node.label, node.attributes, node.node_type);
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

    // Centro X de cada nodo (el que devuelve dagre por defecto).
    const centerX = new Map<string, number>();
    diagram.nodes.forEach((n) => centerX.set(n.id, graph.node(n.id).x));

    // Alineación de CADENA para FLUJO: dagre no garantiza que los nodos de una
    // cadena lineal queden con el centro X idéntico cuando sus anchos difieren, y
    // ese pequeño desfase tuerce las flechas. En flujo alineamos el centro de cada
    // nodo con el de su PADRE cuando el enlace es una cadena pura (el padre tiene un
    // único hijo y el hijo un único padre): así los tramos rectos forman un eje
    // vertical limpio. Las bifurcaciones (decisión con varias salidas) y las
    // confluencias (varias entradas) conservan su X de dagre para no encimarse.
    if (isFlow) {
        const outDeg = new Map<string, number>();
        const inDeg = new Map<string, number>();
        const uniqueParent = new Map<string, string>();
        for (const e of diagram.edges) {
            if (e.source === e.target) continue;
            outDeg.set(e.source, (outDeg.get(e.source) ?? 0) + 1);
            inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
            uniqueParent.set(e.target, e.source);
        }
        // De arriba abajo (y ascendente) para propagar el centro del padre ya alineado.
        const ordered = [...diagram.nodes].sort((a, b) => graph.node(a.id).y - graph.node(b.id).y);
        for (const n of ordered) {
            if (n.position || (inDeg.get(n.id) ?? 0) !== 1) continue;
            const p = uniqueParent.get(n.id)!;
            if ((outDeg.get(p) ?? 0) !== 1) continue;
            const pc = centerX.get(p);
            if (pc != null) centerX.set(n.id, pc);
        }
    }

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
            boxes.set(node.id, { cx: centerX.get(node.id)!, cy: g.y, w, h });
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
            x = centerX.get(node.id)! - g.width / 2;
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