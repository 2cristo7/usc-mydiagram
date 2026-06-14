import { test, expect, describe, vi, afterEach } from 'vitest';
import { diagramFilename, getRenderedNodeBounds, getRenderedEdges } from '../ui/utils/download';

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

// Crea un path SVG que simula .react-flow__edge-path con d y stroke inline.
// getComputedStyle en jsdom no procesa CSS en línea, así que se simula el
// atributo de estilo directamente en el elemento (inline style).
function makeEdgePath(d: string, stroke = '#b1b1b7', strokeWidth = '1'): SVGPathElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path') as SVGPathElement;
    path.setAttribute('class', 'react-flow__edge-path');
    path.setAttribute('d', d);
    // jsdom no evalúa computed style desde atributos SVG presentacionales,
    // pero sí lee la propiedad inline de style; escribimos directamente en
    // el CSSStyleDeclaration para que getComputedStyle lo devuelva.
    path.style.stroke = stroke;
    path.style.strokeWidth = strokeWidth;
    svg.appendChild(path);
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

describe('getRenderedEdges', () => {
    test('devuelve array vacío si no hay paths', () => {
        const vp = document.createElement('div');
        expect(getRenderedEdges(vp)).toEqual([]);
    });

    test('extrae un edge con d, stroke y strokeWidth', () => {
        const vp = document.createElement('div');
        const path = makeEdgePath('M 0 0 L 100 100', '#ff0000', '2');
        vp.appendChild(path.parentElement!);
        const edges = getRenderedEdges(vp);
        expect(edges).toHaveLength(1);
        expect(edges[0].d).toBe('M 0 0 L 100 100');
        expect(edges[0].stroke).toBe('rgb(255, 0, 0)');
        expect(edges[0].strokeWidth).toBe(2);
    });

    test('usa fallback #b1b1b7 cuando getComputedStyle devuelve "none" (mock)', () => {
        // jsdom normaliza stroke:none a rgba(0,0,0,0) en computed style, que no
        // activa el fallback. Para verificar la lógica del fallback mockeamos
        // getComputedStyle para devolver exactamente 'none', que es lo que hace
        // un navegador real ante un path SVG sin stroke explícito en algunas
        // situaciones, o ante stroke="none" en el atributo de presentación.
        const vp = document.createElement('div');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path') as SVGPathElement;
        path.setAttribute('class', 'react-flow__edge-path');
        path.setAttribute('d', 'M 10 20 L 30 40');
        svg.appendChild(path);
        vp.appendChild(svg);

        const origGetComputedStyle = window.getComputedStyle;
        vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
            const cs = origGetComputedStyle(el, pseudo);
            if (el === path) {
                return { ...cs, stroke: 'none', strokeWidth: '' } as CSSStyleDeclaration;
            }
            return cs;
        });

        const edges = getRenderedEdges(vp);
        expect(edges).toHaveLength(1);
        expect(edges[0].stroke).toBe('#b1b1b7');
        expect(edges[0].strokeWidth).toBe(1); // fallback para strokeWidth vacío

        vi.restoreAllMocks();
    });

    test('stroke no asignado en jsdom devuelve el valor computado de jsdom (rgba transparente)', () => {
        // Nota: En jsdom, getComputedStyle de un SVGPathElement sin stroke asignado
        // devuelve 'rgba(0, 0, 0, 0)' (negro transparente), que es truthy y distinto
        // de 'none', por lo que getRenderedEdges devuelve ese valor directamente.
        // En un navegador real con stroke:none devolvería 'none' → fallback #b1b1b7.
        // Este test documenta el comportamiento de jsdom para evitar regresiones.
        const vp = document.createElement('div');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path') as SVGPathElement;
        path.setAttribute('class', 'react-flow__edge-path');
        path.setAttribute('d', 'M 10 20 L 30 40');
        svg.appendChild(path);
        vp.appendChild(svg);
        const edges = getRenderedEdges(vp);
        expect(edges).toHaveLength(1);
        // El stroke devuelto es el valor computado de jsdom (rgba transparente), no ''
        expect(edges[0].stroke).not.toBe('');
        expect(edges[0].strokeWidth).toBe(1); // fallback porque strokeWidth computado es ''
    });

    test('filtra paths sin atributo d (d vacío)', () => {
        const vp = document.createElement('div');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path') as SVGPathElement;
        path.setAttribute('class', 'react-flow__edge-path');
        // Sin atributo d: debe filtrarse
        svg.appendChild(path);
        vp.appendChild(svg);
        expect(getRenderedEdges(vp)).toEqual([]);
    });

    // ── Aristas por tipo de diagrama ──────────────────────────────────────────

    test('erd — 2 aristas (one_to_many, many_to_many) se extraen correctamente', () => {
        const vp = document.createElement('div');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const p1 = makeEdgePath('M 180 60 C 220 60, 250 60, 250 60', '#555555', '1.5');
        const p2 = makeEdgePath('M 430 60 C 470 60, 500 60, 500 60', '#555555', '1.5');
        svg.appendChild(p1.parentElement!.firstChild as Node);
        svg.appendChild(p2.parentElement!.firstChild as Node);
        vp.appendChild(p1.parentElement!);
        vp.appendChild(p2.parentElement!);
        const edges = getRenderedEdges(vp);
        expect(edges).toHaveLength(2);
        expect(edges[0].d).toContain('M 180');
        expect(edges[1].d).toContain('M 430');
    });

    test('sequence — múltiples mensajes (aristas secuencia) extraídos', () => {
        const vp = document.createElement('div');
        const paths = [
            'M 139 150 L 389 150',
            'M 389 200 L 139 200',
            'M 139 260 L 389 260',
        ];
        for (const d of paths) {
            const p = makeEdgePath(d, '#333333', '1');
            vp.appendChild(p.parentElement!);
        }
        const edges = getRenderedEdges(vp);
        expect(edges).toHaveLength(3);
        edges.forEach((e, i) => {
            expect(e.d).toBe(paths[i]);
        });
    });

    test('state_machine — transitions con strokeWidth personalizado', () => {
        const vp = document.createElement('div');
        const p = makeEdgePath('M 120 30 C 200 30, 200 30, 200 30', '#7c3aed', '2.5');
        vp.appendChild(p.parentElement!);
        const edges = getRenderedEdges(vp);
        expect(edges[0].strokeWidth).toBe(2.5);
    });

    test('architecture — depends_on edges con colores distintos', () => {
        const vp = document.createElement('div');
        const colors = ['#0ea5e9', '#10b981', '#f59e0b'];
        for (const c of colors) {
            const p = makeEdgePath(`M 0 0 L 100 0`, c, '1');
            vp.appendChild(p.parentElement!);
        }
        const edges = getRenderedEdges(vp);
        expect(edges).toHaveLength(3);
    });

    test('mindmap — 4 aristas de rama (flow) se extraen todas', () => {
        const vp = document.createElement('div');
        for (let i = 0; i < 4; i++) {
            const p = makeEdgePath(`M ${280 + i * 10} 230 L ${i * 100} 210`, '#b1b1b7', '1');
            vp.appendChild(p.parentElement!);
        }
        const edges = getRenderedEdges(vp);
        expect(edges).toHaveLength(4);
    });
});
