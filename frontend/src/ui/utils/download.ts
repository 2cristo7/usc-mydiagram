// S8.1 — utilidades de exportación de diagramas (nombre de fichero + descarga).
// Compartidas por Export PNG (S8.1) y Export JSON (S8.2): la lógica de capturar
// la imagen o serializar el JSON cambia, pero el nombre del fichero y el disparo
// de la descarga son idénticos.

const ILLEGAL_FILENAME_CHARS = /[/\\:*?"<>|]+/g;

/**
 * Construye el nombre de fichero a partir del título del diagrama.
 * - Sustituye los caracteres ilegales en un filename (`/ \ : * ? " < > |`) por `_`.
 * - Colapsa los espacios en `_` y recorta a 80 caracteres.
 * - Si el título está vacío —el store produce `title: ''` al editar el diagrama a
 *   mano (addNode/addEdge)— cae al fallback `diagrama_<timestamp>`, que garantiza
 *   un nombre único y no vacío.
 */
export function diagramFilename(title: string | undefined, ext: string): string {
    const base = (title ?? '').trim();
    const safe = base
        ? base.replace(ILLEGAL_FILENAME_CHARS, '_').replace(/\s+/g, '_').slice(0, 80)
        : `diagrama_${Date.now()}`;
    return `${safe}.${ext}`;
}

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

const TRANSLATE_RE = /translate(?:3d)?\(\s*([-\d.]+)px,\s*([-\d.]+)px/;

/**
 * Calcula el rectángulo que envuelve TODOS los nodos a partir del DOM ya
 * renderizado, en coordenadas de flujo.
 *
 * Por qué desde el DOM y no con `getNodesBounds`: los nodos de este proyecto no
 * fijan width/height (los crea DiagramToFlow sin dimensiones; dagre solo usa
 * 150×50 para el layout), así que `getNodesBounds` infraestima el ancho y el PNG
 * sale recortado. Cada `.react-flow__node` lleva su `transform: translate(x,y)`
 * en coordenadas de flujo y su `offsetWidth/Height` reales —que el zoom (un CSS
 * transform sobre el viewport padre) no altera—, así que la unión de esos
 * rectángulos es el encuadre fiel de lo que se ve.
 *
 * Devuelve `null` si no hay nodos en el DOM.
 */
export function getRenderedNodeBounds(viewportEl: HTMLElement): Rect | null {
    const nodeEls = viewportEl.querySelectorAll<HTMLElement>('.react-flow__node');
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodeEls.forEach((el) => {
        const m = TRANSLATE_RE.exec(el.style.transform);
        if (!m) return;
        const x = parseFloat(m[1]);
        const y = parseFloat(m[2]);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + el.offsetWidth);
        maxY = Math.max(maxY, y + el.offsetHeight);
    });
    if (!isFinite(minX)) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export interface EdgeStroke {
    /** Comando `d` del path, en coordenadas de flujo. */
    d: string;
    stroke: string;
    strokeWidth: number;
}

/**
 * Lee las aristas renderizadas del DOM: el `d` de cada `.react-flow__edge-path`
 * (en coordenadas de flujo, porque su <svg> está en el origen del viewport sin
 * viewBox) y su trazo computado.
 *
 * Se extraen para dibujarlas NATIVAMENTE en un canvas: Safari no rasteriza el
 * <svg> anidado dentro del <foreignObject> que usa html-to-image, así que las
 * aristas (svg) desaparecen aunque los nodos (HTML) sí salgan. Un path nativo en
 * canvas no pasa por foreignObject y se pinta en cualquier navegador.
 */
export function getRenderedEdges(viewportEl: HTMLElement): EdgeStroke[] {
    return Array.from(viewportEl.querySelectorAll<SVGPathElement>('.react-flow__edge-path'))
        .map((path) => {
            const cs = getComputedStyle(path);
            return {
                d: path.getAttribute('d') ?? '',
                stroke: cs.stroke && cs.stroke !== 'none' ? cs.stroke : '#b1b1b7',
                strokeWidth: parseFloat(cs.strokeWidth) || 1,
            };
        })
        .filter((e) => e.d);
}

/** Carga un data/object URL como `HTMLImageElement` ya decodificado. */
export function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

/**
 * Dispara la descarga de un recurso (data URL u object URL) con el nombre dado,
 * mediante un `<a download>` sintético que se hace click y se descarta. No deja
 * el elemento en el DOM ni necesita estar montado en React.
 */
export function triggerDownload(href: string, filename: string): void {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.click();
}
