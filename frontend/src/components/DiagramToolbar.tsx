import { useRef, useState } from "react";
import { getViewportForBounds } from "@xyflow/react";
import { toPng } from "html-to-image";
import { useStore } from "../store/index";
import { useAuthStore } from "../store/auth";
import { diagramImportSchema } from "../types";
import {
    diagramFilename, triggerDownload, triggerJsonDownload,
    getRenderedNodeBounds, getRenderedEdges, loadImage,
} from "../ui/utils/download";
import { persistCurrentDiagram } from "../lib/api";
import { AuthButton } from "./AuthButton";
import { HistoryPanel } from "./HistoryPanel";

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
    const setCurrentDiagram = useStore((s) => s.setCurrentDiagram);
    const setCurrentDiagramId = useStore((s) => s.setCurrentDiagramId);
    const setUiState = useStore((s) => s.setUiState);
    const user = useAuthStore((s) => s.user);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [saving, setSaving] = useState(false);
    const [savedTick, setSavedTick] = useState(false);

    const canExport = uiState === 'ready';
    // Guardar (explícito, P3-c): exige sesión y un diagrama presente. Cubre las
    // ediciones manuales que no pasan por un `done` del agente (decisión P3: sin
    // debounce, el guardado manual es el camino para persistirlas).
    const canSave = !!user && !!currentDiagram && uiState === 'ready' && !saving;

    async function handleSave() {
        setSaving(true);
        setSavedTick(false);
        const r = await persistCurrentDiagram();
        setSaving(false);
        if (r.ok) {
            setSavedTick(true);
            setTimeout(() => setSavedTick(false), 1500);
        } else if (r.error !== 'no-session') {
            window.alert(`No se pudo guardar: ${r.error}`);
        }
    }
    // Importar disponible al partir de cero (idle), tras un diagrama (ready) o para
    // recuperarse (error). Se bloquea mientras `generating` (un diagrama entrante por
    // WS pisaría/competiría con el importado) y en `awaiting_clarification` (hay un
    // refinamiento en pausa: reemplazar el diagrama dejaría el thread del backend
    // esperando una respuesta sobre un diagrama que ya no existe).
    const canImport =
        uiState === 'idle' || uiState === 'ready' || uiState === 'error';

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

    // Export JSON — formato propio MydIAgram: el DiagramSchema COMPLETO (con title),
    // no el CompactDiagram del agente (que omite title). El fichero es un artefacto
    // de usuario autosuficiente: sirve para recargarlo (import) o dárselo a una IA.
    function handleExportJson() {
        if (!currentDiagram) return;
        triggerJsonDownload(currentDiagram, diagramFilename(currentDiagram.title, 'json'));
    }

    // Import — entrada externa: se valida en el borde con Zod (forma + enums +
    // integridad referencial) ANTES de tocar el canvas. Si el archivo no es un
    // diagrama válido, se avisa y no se modifica nada.
    async function handleImportFile(event: React.ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        event.target.value = ''; // permite reimportar el mismo fichero seguidas veces
        if (!file) return;
        try {
            const parsed = diagramImportSchema.safeParse(JSON.parse(await file.text()));
            if (!parsed.success) {
                console.error('[import] JSON inválido:', parsed.error.issues);
                window.alert('El archivo no es un diagrama MydIAgram válido.');
                return;
            }
            setCurrentDiagram(parsed.data);
            // S9.3 — un diagrama importado no procede de la BD: id null → si se
            // guarda, será un POST (fila nueva), no un PATCH de un id ajeno.
            setCurrentDiagramId(null);
            setUiState('ready');
        } catch (err) {
            console.error('[import] error al leer/parsear el JSON:', err);
            window.alert('No se pudo leer el archivo: no es un JSON válido.');
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
            <button
                onClick={handleExportJson}
                disabled={!canExport}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
                Exportar JSON
            </button>
            {/* Importar disponible también en idle (partir de cero), no durante
                generating/awaiting_clarification (ver canImport). */}
            <button
                onClick={() => fileInputRef.current?.click()}
                disabled={!canImport}
                className="rounded border border-blue-600 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
                Importar JSON
            </button>
            <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleImportFile}
                className="hidden"
            />
            {/* S9.3 — guardado explícito (P3-c). Solo con sesión y diagrama listo;
                persiste también las ediciones manuales que no disparan un done. */}
            <button
                onClick={handleSave}
                disabled={!canSave}
                className="rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
                {saving ? 'Guardando…' : savedTick ? 'Guardado ✓' : 'Guardar'}
            </button>
            {/* S9.3 — historial (solo con sesión), alineado a la derecha junto al login. */}
            <div className="ml-auto flex items-center gap-2">
                <HistoryPanel />
                <AuthButton />
            </div>
        </div>
    );
}
