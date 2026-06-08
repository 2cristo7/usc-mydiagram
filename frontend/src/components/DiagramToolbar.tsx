import { getViewportForBounds } from "@xyflow/react";
import { toPng } from "html-to-image";
import { useStore } from "../store/index";
import {
    diagramFilename, triggerDownload, getRenderedNodeBounds, getRenderedEdges, loadImage,
} from "../ui/utils/download";

// Márgenes de la imagen exportada alrededor del grafo (px) y límites de zoom del
// encuadre. MIN/MAX_ZOOM evitan que un diagrama diminuto se exporte gigantesco o
// uno enorme quede ilegible.
const IMAGE_PADDING = 40;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const FIT_PADDING = 0.1;
const PIXEL_RATIO = 2;

// S8.1 — barra de herramientas del canvas: vive FUERA de <ReactFlow> pero bajo el
// <ReactFlowProvider> de App, así useReactFlow funciona aquí y la barra persiste
// aunque no haya diagrama (necesario para que Importar, S8.2, esté disponible en
// estado idle). Export solo se habilita en `ready`: nunca se exporta un diagrama
// a medio generar ni un refinamiento en pausa (awaiting_clarification).
export function DiagramToolbar() {
    const uiState = useStore((s) => s.uiState);
    const currentDiagram = useStore((s) => s.currentDiagram);

    const canExport = uiState === 'ready';

    async function handleExportPng() {
        const viewportEl = document.querySelector<HTMLElement>('.react-flow__viewport');
        if (!viewportEl) return;

        // P1 — capturamos TODO el grafo, no el viewport visible: los bounds reales
        // de todos los nodos (medidos del DOM) fijan el encuadre, así la imagen es
        // determinista e independiente del pan/zoom con que el usuario dejó el canvas.
        const bounds = getRenderedNodeBounds(viewportEl);
        if (!bounds) return;
        const imageWidth = Math.round(bounds.width) + IMAGE_PADDING * 2;
        const imageHeight = Math.round(bounds.height) + IMAGE_PADDING * 2;
        const viewport = getViewportForBounds(
            bounds, imageWidth, imageHeight, MIN_ZOOM, MAX_ZOOM, FIT_PADDING,
        );

        const transform =
            `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;

        try {
            // NODOS — los pinta html-to-image (HTML dentro de <foreignObject>, que
            // Safari sí rasteriza). Fondo TRANSPARENTE para poder dibujar las aristas
            // por debajo en el canvas. Las etiquetas de arista (HTML) vienen también
            // en esta capa. Las líneas de arista NO: son <svg> anidado y Safari las
            // deja en blanco (ver getRenderedEdges) → las añadimos nativamente abajo.
            const nodesUrl = await toPng(viewportEl, {
                width: imageWidth,
                height: imageHeight,
                pixelRatio: PIXEL_RATIO,
                style: { width: `${imageWidth}px`, height: `${imageHeight}px`, transform },
            });
            const nodesImg = await loadImage(nodesUrl);

            const canvas = document.createElement('canvas');
            canvas.width = imageWidth * PIXEL_RATIO;
            canvas.height = imageHeight * PIXEL_RATIO;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            // Trabajamos en px CSS; el PIXEL_RATIO da nitidez 2×.
            ctx.scale(PIXEL_RATIO, PIXEL_RATIO);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, imageWidth, imageHeight);

            // ARISTAS (debajo de los nodos) en coordenadas de flujo, con el MISMO
            // encuadre (translate+scale) que html-to-image aplicó al viewport, para
            // que alineen pixel a pixel con los nodos.
            ctx.save();
            ctx.translate(viewport.x, viewport.y);
            ctx.scale(viewport.zoom, viewport.zoom);
            for (const edge of getRenderedEdges(viewportEl)) {
                ctx.strokeStyle = edge.stroke;
                ctx.lineWidth = edge.strokeWidth;
                ctx.stroke(new Path2D(edge.d));
            }
            ctx.restore();

            // NODOS encima (la capa de html-to-image, transparente salvo nodos/labels).
            ctx.drawImage(nodesImg, 0, 0, imageWidth, imageHeight);

            triggerDownload(canvas.toDataURL('image/png'), diagramFilename(currentDiagram?.title, 'png'));
        } catch (err) {
            // toPng/loadImage pueden rechazar (timeout, recurso no decodificable…).
            // Lo capturamos para no dejar una promesa rechazada sin manejar; el botón
            // sigue operativo para reintentar. Mejora de UX (toast) → pendientes.md.
            console.error('[export] fallo al exportar PNG:', err);
        }
    }

    return (
        <div className="flex items-center gap-2 border-b bg-white px-4 py-2">
            <button
                onClick={handleExportPng}
                disabled={!canExport}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
                Exportar PNG
            </button>
        </div>
    );
}
