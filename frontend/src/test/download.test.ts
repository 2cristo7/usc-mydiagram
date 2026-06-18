import { test, expect, describe, vi } from 'vitest';
import { diagramFilename, getRenderedNodeBounds, getRenderedEdges, drawArrowMarker, unionRects } from '../ui/utils/download';
import type { ArrowMarker } from '../ui/utils/download';

// S8.3 — pieza pura del export (PNG y JSON comparten el nombre de fichero). El
// render del PNG (canvas + html-to-image) no es testeable en jsdom —no rasteriza—,
// así que se valida manualmente; aquí se cubre la lógica determinista del nombre.

describe('diagramFilename', () => {
    test('usa el título, con los espacios como _', () => {
        expect(diagramFilename('Mi diagrama', 'png')).toBe('Mi_diagrama.png');
    });

    test('sanea los caracteres ilegales en un filename', () => {
        expect(diagramFilename('a/b:c*d?', 'json')).toBe('a_b_c_d_.json');
    });

    test('título vacío → fallback diagrama_<timestamp>', () => {
        expect(diagramFilename('', 'png')).toMatch(/^diagrama_\d+\.png$/);
    });

    test('título solo espacios → fallback', () => {
        expect(diagramFilename('   ', 'png')).toMatch(/^diagrama_\d+\.png$/);
    });

    test('undefined (no hay currentDiagram) → fallback', () => {
        expect(diagramFilename(undefined, 'json')).toMatch(/^diagrama_\d+\.json$/);
    });

    test('recorta el nombre a 80 caracteres', () => {
        const base = diagramFilename('a'.repeat(200), 'png').replace('.png', '');
        expect(base.length).toBe(80);
    });

    // Títulos representativos de cada tipo de diagrama
    test('erd — título con guiones y mayúsculas', () => {
        expect(diagramFilename('Sistema-ERD_v2', 'png')).toBe('Sistema-ERD_v2.png');
    });

    test('uml_class — título con paréntesis (chars ilegales en win: no, ok aquí)', () => {
        expect(diagramFilename('Clases UML (módulo auth)', 'json')).toBe('Clases_UML_(módulo_auth).json');
    });

    test('sequence — caracteres < > se sanean', () => {
        expect(diagramFilename('Flujo <login> usuario', 'png')).toBe('Flujo__login__usuario.png');
    });

    test('flowchart — título largo pero < 80 chars pasa completo', () => {
        const title = 'Diagrama de flujo de validación de formulario';
        const result = diagramFilename(title, 'png');
        expect(result).toBe(`${title.replace(/\s+/g, '_')}.png`);
        expect(result.replace('.png', '').length).toBeLessThanOrEqual(80);
    });

    test('architecture — título con dos puntos (char ilegal)', () => {
        expect(diagramFilename('Arquitectura: microservicios', 'png')).toBe('Arquitectura__microservicios.png');
    });

    test('state_machine — título con barra (char ilegal)', () => {
        expect(diagramFilename('Estado/Transición auth', 'png')).toBe('Estado_Transición_auth.png');
    });

    test('mindmap — título exactamente 80 chars NO se recorta', () => {
        const title = 'a'.repeat(80);
        expect(diagramFilename(title, 'png')).toBe(`${title}.png`);
    });
});

// Crea un .react-flow__node con su transform y dimensiones. En jsdom no hay layout,
// así que offsetWidth/Height son siempre 0: se mockean por instancia (el bug del
// encuadre era precisamente que los bounds ignoraban el tamaño real de los nodos).
function makeNode(x: number, y: number, w: number, h: number): HTMLElement {
    const el = document.createElement('div');
    el.className = 'react-flow__node';
    el.style.transform = `translate(${x}px, ${y}px)`;
    Object.defineProperty(el, 'offsetWidth', { value: w, configurable: true });
    Object.defineProperty(el, 'offsetHeight', { value: h, configurable: true });
    return el;
}

// Crea la estructura DOM de una arista de React Flow —`<svg><g class="react-flow__edge">
// <path/></g></svg>`— y la cuelga de `vp`. getRenderedEdges ya no mira una clase
// concreta del path (es independiente del tipo de arista): recorre los `<path>`
// dentro de cualquier `.react-flow__edge`. getComputedStyle en jsdom no procesa
// CSS en línea pero sí la propiedad inline de style, así que se escribe directa.
function appendEdge(
    vp: HTMLElement,
    d: string,
    opts: { stroke?: string; strokeWidth?: string; dash?: string } = {},
): SVGPathElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'react-flow__edge');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path') as SVGPathElement;
    if (d) path.setAttribute('d', d);
    path.style.stroke = opts.stroke ?? '#b1b1b7';
    path.style.strokeWidth = opts.strokeWidth ?? '1';
    if (opts.dash) path.style.strokeDasharray = opts.dash;
    g.appendChild(path);
    svg.appendChild(g);
    vp.appendChild(svg);
    return path;
}

describe('getRenderedNodeBounds', () => {
    test('une los rectángulos de todos los nodos (coordenadas de flujo)', () => {
        const vp = document.createElement('div');
        vp.appendChild(makeNode(0, 0, 100, 50));
        vp.appendChild(makeNode(200, 300, 150, 60));
        // maxX = 200+150 = 350; maxY = 300+60 = 360
        expect(getRenderedNodeBounds(vp)).toEqual({ x: 0, y: 0, width: 350, height: 360 });
    });

    test('soporta translate3d y coordenadas negativas', () => {
        const vp = document.createElement('div');
        const el = makeNode(0, 0, 100, 40);
        el.style.transform = 'translate3d(-50px, -20px, 0px)';
        vp.appendChild(el);
        expect(getRenderedNodeBounds(vp)).toEqual({ x: -50, y: -20, width: 100, height: 40 });
    });

    test('parsea coordenadas en notación científica (no excluye el nodo)', () => {
        // React Flow emite a veces `translate(-330px, 4.04e-14px)` (un 0 con
        // error de coma flotante). El regex debe casarlo; si no, el nodo del
        // extremo quedaría fuera de los bounds y el PNG lo recortaría.
        const vp = document.createElement('div');
        const left = makeNode(0, 0, 88, 28);
        left.style.transform = 'translate(-330px, 4.04133e-14px)';
        vp.appendChild(left);
        vp.appendChild(makeNode(-277, 0, 89, 28)); // antes era el "más a la izquierda"
        // minX debe ser -330 (el nodo en notación científica), no -277.
        const b = getRenderedNodeBounds(vp)!;
        expect(b.x).toBe(-330);
    });

    test('devuelve null si no hay nodos', () => {
        expect(getRenderedNodeBounds(document.createElement('div'))).toBeNull();
    });

    // ── Bounds por tipo de diagrama ────────────────────────────────────────────

    test('erd — 3 tablas (tabla Users, Orders, Products) calcula bounds correctos', () => {
        const vp = document.createElement('div');
        // Users: pos(0,0) 180×120
        vp.appendChild(makeNode(0, 0, 180, 120));
        // Orders: pos(250,0) 180×150
        vp.appendChild(makeNode(250, 0, 180, 150));
        // Products: pos(500,0) 200×130
        vp.appendChild(makeNode(500, 0, 200, 130));
        // minX=0, minY=0, maxX=700, maxY=150
        expect(getRenderedNodeBounds(vp)).toEqual({ x: 0, y: 0, width: 700, height: 150 });
    });

    test('uml_class — 2 clases con herencia: ambas entran en bounds', () => {
        const vp = document.createElement('div');
        // Clase base: pos(100,50) 160×200
        vp.appendChild(makeNode(100, 50, 160, 200));
        // Subclase: pos(100,350) 160×180
        vp.appendChild(makeNode(100, 350, 160, 180));
        // minX=100, minY=50, maxX=260, maxY=530 → w=160, h=480
        expect(getRenderedNodeBounds(vp)).toEqual({ x: 100, y: 50, width: 160, height: 480 });
    });

    test('sequence — actores + lifelines + activaciones: todos entran en bounds', () => {
        // En secuencia, sequenceLayout genera nodos actor, lifeline y activation.
        // Los lifelines son altos (ocupan toda la altura del diagrama).
        const vp = document.createElement('div');
        // Actor 1 (cabecera): pos(100,0) 80×60
        vp.appendChild(makeNode(100, 0, 80, 60));
        // Actor 2 (cabecera): pos(350,0) 80×60
        vp.appendChild(makeNode(350, 0, 80, 60));
        // Lifeline 1: pos(135,60) 4×400 (línea punteada vertical)
        vp.appendChild(makeNode(135, 60, 4, 400));
        // Lifeline 2: pos(385,60) 4×400
        vp.appendChild(makeNode(385, 60, 4, 400));
        // Activation 1: pos(133,120) 8×60
        vp.appendChild(makeNode(133, 120, 8, 60));
        // minX=100, minY=0, maxX=469 (385+4+80 pero maxX=max(180,430,139,389,141))
        // maxX = max(100+80, 350+80, 135+4, 385+4, 133+8) = max(180,430,139,389,141) = 430
        // maxY = max(0+60, 0+60, 60+400, 60+400, 120+60) = max(60,60,460,460,180) = 460
        // w = 430-100 = 330, h = 460-0 = 460
        expect(getRenderedNodeBounds(vp)).toEqual({ x: 100, y: 0, width: 330, height: 460 });
    });

    test('flowchart — nodos de decisión + pasos en disposición vertical', () => {
        const vp = document.createElement('div');
        // Start (terminator): pos(200,0) 120×50
        vp.appendChild(makeNode(200, 0, 120, 50));
        // Step: pos(200,100) 140×60
        vp.appendChild(makeNode(200, 100, 140, 60));
        // Decision: pos(190,220) 160×80
        vp.appendChild(makeNode(190, 220, 160, 80));
        // End (terminator): pos(200,360) 120×50
        vp.appendChild(makeNode(200, 360, 120, 50));
        // minX=190, minY=0, maxX=350, maxY=410 → w=160, h=410
        expect(getRenderedNodeBounds(vp)).toEqual({ x: 190, y: 0, width: 160, height: 410 });
    });

    test('architecture — servicios + db + queue: bounds cubren todo', () => {
        const vp = document.createElement('div');
        // Frontend: pos(0,0) 150×80
        vp.appendChild(makeNode(0, 0, 150, 80));
        // API Gateway: pos(200,0) 150×80
        vp.appendChild(makeNode(200, 0, 150, 80));
        // DB: pos(100,200) 150×80
        vp.appendChild(makeNode(100, 200, 150, 80));
        // Queue: pos(350,200) 150×80
        vp.appendChild(makeNode(350, 200, 150, 80));
        // minX=0, minY=0, maxX=500, maxY=280 → w=500, h=280
        expect(getRenderedNodeBounds(vp)).toEqual({ x: 0, y: 0, width: 500, height: 280 });
    });

    test('state_machine — estados con coordenadas negativas (centrado en origen)', () => {
        const vp = document.createElement('div');
        // Estado inicial: pos(-200,-100) 120×60
        vp.appendChild(makeNode(-200, -100, 120, 60));
        // Estado intermedio: pos(0,0) 120×60
        vp.appendChild(makeNode(0, 0, 120, 60));
        // Estado final: pos(200,100) 120×60
        vp.appendChild(makeNode(200, 100, 120, 60));
        // minX=-200, minY=-100, maxX=320, maxY=160 → w=520, h=260
        expect(getRenderedNodeBounds(vp)).toEqual({ x: -200, y: -100, width: 520, height: 260 });
    });

    test('mindmap — nodo central + 4 ramas: bounds calculados correctamente', () => {
        const vp = document.createElement('div');
        // Central: pos(200,200) 160×60
        vp.appendChild(makeNode(200, 200, 160, 60));
        // Rama arriba: pos(220,-50) 120×50
        vp.appendChild(makeNode(220, -50, 120, 50));
        // Rama derecha: pos(450,210) 120×50
        vp.appendChild(makeNode(450, 210, 120, 50));
        // Rama abajo: pos(220,350) 120×50
        vp.appendChild(makeNode(220, 350, 120, 50));
        // Rama izquierda: pos(-50,210) 120×50
        vp.appendChild(makeNode(-50, 210, 120, 50));
        // minX=-50, minY=-50, maxX=570, maxY=400 → w=620, h=450
        expect(getRenderedNodeBounds(vp)).toEqual({ x: -50, y: -50, width: 620, height: 450 });
    });

    // ── Casos límite ──────────────────────────────────────────────────────────

    test('caso límite: 1 solo nodo sin aristas', () => {
        const vp = document.createElement('div');
        vp.appendChild(makeNode(50, 30, 200, 100));
        expect(getRenderedNodeBounds(vp)).toEqual({ x: 50, y: 30, width: 200, height: 100 });
    });

    test('caso límite: coordenadas negativas extremas', () => {
        const vp = document.createElement('div');
        vp.appendChild(makeNode(-1000, -500, 100, 50));
        vp.appendChild(makeNode(500, 300, 80, 40));
        // minX=-1000, minY=-500, maxX=580, maxY=340 → w=1580, h=840
        expect(getRenderedNodeBounds(vp)).toEqual({ x: -1000, y: -500, width: 1580, height: 840 });
    });

    test('caso límite: diagrama grande (20 nodos en grid)', () => {
        const vp = document.createElement('div');
        // 4 columnas × 5 filas, cada nodo 150×80, separación 50px
        for (let row = 0; row < 5; row++) {
            for (let col = 0; col < 4; col++) {
                vp.appendChild(makeNode(col * 200, row * 130, 150, 80));
            }
        }
        // minX=0, minY=0, maxX=3*200+150=750, maxY=4*130+80=600
        expect(getRenderedNodeBounds(vp)).toEqual({ x: 0, y: 0, width: 750, height: 600 });
    });
});

describe('unionRects', () => {
    test('une dos rectángulos disjuntos', () => {
        expect(
            unionRects({ x: 0, y: 0, width: 100, height: 50 }, { x: 200, y: 100, width: 80, height: 40 }),
        ).toEqual({ x: 0, y: 0, width: 280, height: 140 });
    });

    test('rectángulo de aristas que sobresale por la izquierda y abajo amplía los bounds', () => {
        // Nodos en [0,0..200,200]; una arista se curva a x=-60 y baja a y=260.
        const nodes = { x: 0, y: 0, width: 200, height: 200 };
        const edges = { x: -60, y: 50, width: 100, height: 210 }; // llega a x=40, y=260
        expect(unionRects(nodes, edges)).toEqual({ x: -60, y: 0, width: 260, height: 260 });
    });

    test('un rectángulo contenido en el otro no cambia los bounds', () => {
        const outer = { x: 0, y: 0, width: 300, height: 300 };
        expect(unionRects(outer, { x: 50, y: 50, width: 100, height: 100 })).toEqual(outer);
    });

    test('null en cualquier lado devuelve el otro; ambos null → null', () => {
        const r = { x: 1, y: 2, width: 3, height: 4 };
        expect(unionRects(r, null)).toEqual(r);
        expect(unionRects(null, r)).toEqual(r);
        expect(unionRects(null, null)).toBeNull();
    });
});

describe('getRenderedEdges', () => {
    test('devuelve array vacío si no hay paths', () => {
        const vp = document.createElement('div');
        expect(getRenderedEdges(vp)).toEqual([]);
    });

    test('extrae un edge con d, stroke, strokeWidth y dash vacío', () => {
        const vp = document.createElement('div');
        appendEdge(vp, 'M 0 0 L 100 100', { stroke: '#ff0000', strokeWidth: '2' });
        const edges = getRenderedEdges(vp);
        expect(edges).toHaveLength(1);
        expect(edges[0].d).toBe('M 0 0 L 100 100');
        expect(edges[0].stroke).toBe('rgb(255, 0, 0)');
        expect(edges[0].strokeWidth).toBe(2);
        expect(edges[0].dash).toEqual([]);
    });

    test('parsea el patrón de guiones (strokeDasharray)', () => {
        const vp = document.createElement('div');
        appendEdge(vp, 'M 0 0 L 100 0', { stroke: '#000', dash: '8 4' });
        const edges = getRenderedEdges(vp);
        expect(edges).toHaveLength(1);
        expect(edges[0].dash).toEqual([8, 4]);
    });

    test('descarta los paths de trazo invisible (área de click transparente)', () => {
        // Cada arista de React Flow añade un path ancho y transparente para
        // facilitar el click. Tiene `d` válido pero no pinta nada: no debe salir.
        const vp = document.createElement('div');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'react-flow__edge');
        const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path') as SVGPathElement;
        hit.setAttribute('d', 'M 0 0 L 100 0');
        hit.style.stroke = 'transparent';
        hit.style.strokeWidth = '20';
        const visible = document.createElementNS('http://www.w3.org/2000/svg', 'path') as SVGPathElement;
        visible.setAttribute('d', 'M 0 0 L 100 0');
        visible.style.stroke = '#111111';
        visible.style.strokeWidth = '2';
        g.append(hit, visible);
        svg.appendChild(g);
        vp.appendChild(svg);
        const edges = getRenderedEdges(vp);
        expect(edges).toHaveLength(1); // solo el visible
        expect(edges[0].stroke).toBe('rgb(17, 17, 17)');
    });

    test('descarta stroke "none" (mock de getComputedStyle)', () => {
        const vp = document.createElement('div');
        const path = appendEdge(vp, 'M 10 20 L 30 40');
        const origGetComputedStyle = window.getComputedStyle;
        vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
            const cs = origGetComputedStyle(el, pseudo);
            if (el === path) return { ...cs, stroke: 'none', strokeWidth: '', strokeDasharray: 'none' } as CSSStyleDeclaration;
            return cs;
        });
        expect(getRenderedEdges(vp)).toEqual([]);
        vi.restoreAllMocks();
    });

    test('filtra paths sin atributo d (d vacío)', () => {
        const vp = document.createElement('div');
        appendEdge(vp, '', { stroke: '#111' });
        expect(getRenderedEdges(vp)).toEqual([]);
    });

    // ── Aristas por tipo de diagrama (selector general .react-flow__edge path) ──

    test('erd — 2 aristas (one_to_many, many_to_many) se extraen correctamente', () => {
        const vp = document.createElement('div');
        appendEdge(vp, 'M 180 60 C 220 60, 250 60, 250 60', { stroke: '#555555', strokeWidth: '1.5' });
        appendEdge(vp, 'M 430 60 C 470 60, 500 60, 500 60', { stroke: '#555555', strokeWidth: '1.5' });
        const edges = getRenderedEdges(vp);
        expect(edges).toHaveLength(2);
        expect(edges[0].d).toContain('M 180');
        expect(edges[1].d).toContain('M 430');
    });

    test('sequence — múltiples mensajes (aristas secuencia) extraídos', () => {
        const vp = document.createElement('div');
        const paths = ['M 139 150 L 389 150', 'M 389 200 L 139 200', 'M 139 260 L 389 260'];
        for (const d of paths) appendEdge(vp, d, { stroke: '#333333' });
        const edges = getRenderedEdges(vp);
        expect(edges).toHaveLength(3);
        edges.forEach((e, i) => expect(e.d).toBe(paths[i]));
    });

    test('state_machine — transitions con strokeWidth personalizado', () => {
        const vp = document.createElement('div');
        appendEdge(vp, 'M 120 30 C 200 30, 200 30, 200 30', { stroke: '#7c3aed', strokeWidth: '2.5' });
        expect(getRenderedEdges(vp)[0].strokeWidth).toBe(2.5);
    });

    test('architecture — depends_on edges con colores distintos', () => {
        const vp = document.createElement('div');
        for (const c of ['#0ea5e9', '#10b981', '#f59e0b']) appendEdge(vp, 'M 0 0 L 100 0', { stroke: c });
        expect(getRenderedEdges(vp)).toHaveLength(3);
    });

    test('mindmap — 4 aristas de rama (flow) se extraen todas', () => {
        const vp = document.createElement('div');
        for (let i = 0; i < 4; i++) appendEdge(vp, `M ${280 + i * 10} 230 L ${i * 100} 210`, { stroke: '#b1b1b7' });
        expect(getRenderedEdges(vp)).toHaveLength(4);
    });

    test('jsdom no rasteriza SVG → markers vacío (sin getTotalLength)', () => {
        // getPathMarkers cae a [] cuando getTotalLength no existe (jsdom). Aunque
        // no se calculen, el campo debe estar presente para no romper el caller.
        const vp = document.createElement('div');
        appendEdge(vp, 'M 0 0 L 100 0', { stroke: '#111' });
        expect(getRenderedEdges(vp)[0].markers).toEqual([]);
    });
});

// drawArrowMarker es la pieza que reconstruye las puntas de flecha en el canvas
// del export (los <marker> SVG no se rasterizan). Se valida contra un ctx mock:
// la geometría exacta del trazado es lo que en producción dibuja el triángulo.
describe('drawArrowMarker', () => {
    function mockCtx() {
        return {
            save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
            beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(),
            stroke: vi.fn(), fill: vi.fn(),
            lineWidth: 0, lineJoin: '', strokeStyle: '', fillStyle: '',
        };
    }

    test('punta abierta (#arrow): traza la «V» sin relleno, con el ink color', () => {
        const ctx = mockCtx();
        const marker: ArrowMarker = { x: 100, y: 50, angle: 0, id: 'arrow' };
        drawArrowMarker(ctx as never, marker, '#111111', '#ffffff');
        expect(ctx.translate).toHaveBeenCalledWith(100, 50);
        expect(ctx.rotate).toHaveBeenCalledWith(0);
        expect(ctx.moveTo).toHaveBeenCalledWith(-8, -4);
        expect(ctx.lineTo).toHaveBeenCalledWith(0, 0);
        expect(ctx.lineTo).toHaveBeenCalledWith(-8, 4);
        expect(ctx.fill).not.toHaveBeenCalled();
        expect(ctx.stroke).toHaveBeenCalled();
        expect(ctx.strokeStyle).toBe('#111111');
    });

    test('punta hueca (#arrowHollow): triángulo cerrado, relleno con surface', () => {
        const ctx = mockCtx();
        const marker: ArrowMarker = { x: 0, y: 0, angle: Math.PI, id: 'arrowHollow' };
        drawArrowMarker(ctx as never, marker, '#111111', '#ffffff');
        expect(ctx.moveTo).toHaveBeenCalledWith(-12, -6);
        expect(ctx.lineTo).toHaveBeenCalledWith(-12, 6);
        expect(ctx.closePath).toHaveBeenCalled();
        expect(ctx.fill).toHaveBeenCalled();
        expect(ctx.fillStyle).toBe('#ffffff');
        expect(ctx.stroke).toHaveBeenCalled();
    });

    test('id desconocido cae al shape de #arrow', () => {
        const ctx = mockCtx();
        drawArrowMarker(ctx as never, { x: 0, y: 0, angle: 0, id: 'desconocido' }, '#000', '#fff');
        expect(ctx.moveTo).toHaveBeenCalledWith(-8, -4);
        expect(ctx.fill).not.toHaveBeenCalled();
    });
});
