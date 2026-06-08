import { test, expect, describe } from 'vitest';
import { diagramFilename, getRenderedNodeBounds } from '../ui/utils/download';

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
});
