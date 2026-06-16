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

// Captura las dos primeras coordenadas de `translate(...)` / `translate3d(...)`.
// El número admite signo, decimales y NOTACIÓN CIENTÍFICA: React Flow emite a
// veces valores como `translate(-330px, 4.04e-14px)` (un 0 con error de coma
// flotante). Un `[-\d.]+` ingenuo NO casa el `e-14`, falla el match entero y el
// nodo queda fuera de los bounds → el PNG lo recorta (era el bug del nodo del
// extremo recortado). El patrón de float completo lo evita.
const FLOAT = String.raw`[-+]?[\d.]+(?:e[-+]?\d+)?`;
const TRANSLATE_RE = new RegExp(`translate(?:3d)?\\(\\s*(${FLOAT})px,\\s*(${FLOAT})px`, 'i');

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

/**
 * Une dos rectángulos (cualquiera de los dos puede ser `null`). Si ambos son
 * `null`, devuelve `null`. Pieza pura, testeable sin DOM.
 */
export function unionRects(a: Rect | null, b: Rect | null): Rect | null {
    if (!a) return b;
    if (!b) return a;
    const minX = Math.min(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxX = Math.max(a.x + a.width, b.x + b.width);
    const maxY = Math.max(a.y + a.height, b.y + b.height);
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Bounds de las aristas renderizadas, en coordenadas de flujo, a partir del
 * `getBBox()` de cada `<path>` de arista.
 *
 * Por qué hace falta: las aristas de este proyecto se curvan (mindmap) o se
 * enrutan a los HANDLES laterales de los nodos (p. ej. las relaciones de un ERD
 * con las tablas apiladas en vertical), saliéndose del rectángulo que cubren los
 * nodos. Si el encuadre del PNG solo mira los nodos (`getRenderedNodeBounds`),
 * esas aristas caen fuera del recorte y desaparecen de la imagen. Uniendo estos
 * bounds con los de los nodos, el encuadre cubre el diagrama ENTERO.
 *
 * `getBBox()` devuelve la caja del path en el sistema de coordenadas de su
 * `<svg>`, que en React Flow está en el origen del viewport sin `viewBox` → son
 * coordenadas de flujo, las mismas que el `translate` de los nodos. Se filtran
 * los paths de área de click (transparentes, anchos) por tener bbox válida pero
 * no aportar nada distinto al trazo visible (su bbox coincide con la del visible).
 *
 * Nota: `getBBox` no existe en jsdom (solo navegador), así que esta función no se
 * cubre en los tests unitarios; sí lo está `unionRects`, la parte pura.
 */
export function getRenderedEdgeBounds(viewportEl: HTMLElement): Rect | null {
    const paths = viewportEl.querySelectorAll<SVGPathElement>('.react-flow__edge path');
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    paths.forEach((p) => {
        let box: DOMRect;
        try {
            box = p.getBBox();
        } catch {
            return; // jsdom u otros entornos sin layout SVG
        }
        if (box.width === 0 && box.height === 0) return;
        minX = Math.min(minX, box.x);
        minY = Math.min(minY, box.y);
        maxX = Math.max(maxX, box.x + box.width);
        maxY = Math.max(maxY, box.y + box.height);
    });
    if (!isFinite(minX)) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export interface EdgeStroke {
    /** Comando `d` del path, en coordenadas de flujo. */
    d: string;
    stroke: string;
    strokeWidth: number;
    /** Patrón de guiones (`dashed`/`dotted`), ya parseado a números; `[]` si es continuo. */
    dash: number[];
}

/**
 * ¿El trazo computado es visible? Descarta `none` y cualquier color totalmente
 * transparente (`rgba(...,0)` / `transparent`). Así se filtran los paths de
 * ÁREA DE CLICK que cada arista añade (un trazo ancho y transparente para
 * facilitar la selección): tienen `d` válido pero no pintan nada, y dibujarlos
 * en el canvas sería ruido.
 */
function isVisibleStroke(stroke: string): boolean {
    if (!stroke || stroke === 'none' || stroke === 'transparent') return false;
    // Solo `rgba(...)` lleva alpha (4º componente). Ojo: NO usar el "último número
    // antes de )" como alpha, porque en `rgb(255, 0, 0)` ese sería el azul (0) y
    // descartaría el rojo por error. `rgb(...)` (3 componentes) es siempre opaco.
    const m = stroke.match(/rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/);
    if (m && parseFloat(m[1]) === 0) return false;
    return true;
}

/**
 * Lee las aristas renderizadas del DOM para dibujarlas NATIVAMENTE en el canvas:
 * Safari no rasteriza el <svg> anidado en el <foreignObject> de html-to-image,
 * así que las aristas (svg) desaparecerían aunque los nodos (HTML) salgan. Un
 * path nativo en canvas no pasa por foreignObject y se pinta en cualquier
 * navegador.
 *
 * Forma GENERAL e independiente del tipo de arista: en lugar de mirar una clase
 * concreta (`.react-flow__edge-path`, que NINGÚN edge custom de este proyecto
 * usa —EditableEdge, ArchitectureEdge, MindmapBranchEdge, SequenceMessageEdge—,
 * dejando el fallback muerto), recorre TODOS los `<path>` dentro de cualquier
 * `.react-flow__edge` y se queda con los de trazo visible. Cualquier tipo de
 * arista nuevo que se añada en el futuro queda cubierto sin tocar esto. El `d`
 * está en coordenadas de flujo (el <svg> de aristas vive en el origen del
 * viewport sin viewBox), las mismas que el resto del export.
 */
export function getRenderedEdges(viewportEl: HTMLElement): EdgeStroke[] {
    return Array.from(viewportEl.querySelectorAll<SVGPathElement>('.react-flow__edge path'))
        .map((path) => {
            const cs = getComputedStyle(path);
            const dasharray = cs.strokeDasharray;
            return {
                d: path.getAttribute('d') ?? '',
                stroke: cs.stroke,
                strokeWidth: parseFloat(cs.strokeWidth) || 1,
                dash:
                    dasharray && dasharray !== 'none'
                        ? dasharray.split(/[\s,]+/).map(parseFloat).filter((n) => !isNaN(n))
                        : [],
            };
        })
        .filter((e) => e.d && isVisibleStroke(e.stroke));
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

/**
 * Serializa un objeto a JSON (indentado) y lo descarga. Usa un data URL en vez de
 * `URL.createObjectURL` para no tener que revocar nada (sin fuga de object URLs).
 */
export function triggerJsonDownload(data: unknown, filename: string): void {
    const json = JSON.stringify(data, null, 2);
    const href = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
    triggerDownload(href, filename);
}
