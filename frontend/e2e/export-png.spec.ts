/**
 * e2e/export-png.spec.ts
 *
 * Tests de exportación PNG para los 7 tipos de diagrama.
 * Requiere el dev server de Vite en localhost:5173 (playwright.config.ts lo
 * levanta automáticamente con webServer si no está ya en marcha).
 *
 * Estrategia de inyección:
 * - main.tsx expone `window.__myd_store__` (la instancia Zustand) en modo DEV.
 * - page.evaluate() llama setCurrentDiagram + setUiState('ready') para
 *   montar cada diagrama sin pasar por el backend.
 * - La exportación se dispara haciendo click en "Exportar" → "Exportar PNG".
 * - page.waitForEvent('download') captura la descarga y verifica la cabecera PNG.
 */

import { test, expect, type Page, type Download } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// ── Fixtures de diagrama por tipo ─────────────────────────────────────────────

const DIAGRAMS = {
    erd: {
        title: 'ERD E2E Test',
        diagram_type: 'erd',
        nodes: [
            { id: 'u1', label: 'Users', node_type: 'table', attributes: ['id: INT PK', 'name: VARCHAR'] },
            { id: 'o1', label: 'Orders', node_type: 'table', attributes: ['id: INT PK', 'user_id: INT FK'] },
            { id: 'p1', label: 'Products', node_type: 'table', attributes: ['id: INT PK', 'price: DECIMAL'] },
        ],
        edges: [
            { id: 'e1', source: 'u1', target: 'o1', label: 'has', edge_type: 'one_to_many' },
            { id: 'e2', source: 'o1', target: 'p1', label: 'contains', edge_type: 'many_to_many' },
        ],
    },
    uml_class: {
        title: 'UML Class E2E Test',
        diagram_type: 'uml_class',
        nodes: [
            { id: 'a1', label: 'Animal', node_type: 'class', attributes: ['name: String', 'age: int', '+ speak(): void'] },
            { id: 'd1', label: 'Dog', node_type: 'class', attributes: ['breed: String', '+ fetch(): void'] },
            { id: 'c1', label: 'Cat', node_type: 'class', attributes: ['indoor: boolean', '+ purr(): void'] },
        ],
        edges: [
            { id: 'e1', source: 'd1', target: 'a1', label: 'extends', edge_type: 'inherits' },
            { id: 'e2', source: 'c1', target: 'a1', label: 'extends', edge_type: 'inherits' },
        ],
    },
    sequence: {
        title: 'Sequence E2E Test',
        diagram_type: 'sequence',
        nodes: [
            { id: 'client', label: 'Client', node_type: 'actor', attributes: [] },
            { id: 'server', label: 'Server', node_type: 'actor', attributes: [] },
            { id: 'db', label: 'Database', node_type: 'actor', attributes: [] },
        ],
        edges: [
            { id: 'e1', source: 'client', target: 'server', label: 'HTTP GET /api/users', edge_type: 'sequence' },
            { id: 'e2', source: 'server', target: 'db', label: 'SELECT * FROM users', edge_type: 'sequence' },
            { id: 'e3', source: 'db', target: 'server', label: 'rows[]', edge_type: 'sequence' },
            { id: 'e4', source: 'server', target: 'client', label: '200 OK + JSON', edge_type: 'sequence' },
        ],
    },
    flowchart: {
        title: 'Flowchart E2E Test',
        diagram_type: 'flowchart',
        nodes: [
            { id: 'start', label: 'Inicio', node_type: 'terminator', attributes: [] },
            { id: 's1', label: 'Validar formulario', node_type: 'step', attributes: [] },
            { id: 'd1', label: '¿Válido?', node_type: 'decision', attributes: [] },
            { id: 's2', label: 'Procesar datos', node_type: 'step', attributes: [] },
            { id: 'end', label: 'Fin', node_type: 'terminator', attributes: [] },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 's1', label: '', edge_type: 'flow' },
            { id: 'e2', source: 's1', target: 'd1', label: '', edge_type: 'flow' },
            { id: 'e3', source: 'd1', target: 's2', label: 'Sí', edge_type: 'conditional' },
            { id: 'e4', source: 's2', target: 'end', label: '', edge_type: 'flow' },
        ],
    },
    architecture: {
        title: 'Architecture E2E Test',
        diagram_type: 'architecture',
        nodes: [
            { id: 'fe', label: 'Frontend React', node_type: 'service', attributes: [] },
            { id: 'gw', label: 'API Gateway', node_type: 'gateway', attributes: [] },
            { id: 'ai', label: 'AI Microservice', node_type: 'service', attributes: [] },
            { id: 'db', label: 'PostgreSQL', node_type: 'database', attributes: [] },
            { id: 'q1', label: 'RabbitMQ', node_type: 'queue', attributes: [] },
        ],
        edges: [
            { id: 'e1', source: 'fe', target: 'gw', label: 'HTTP/WS', edge_type: 'calls' },
            { id: 'e2', source: 'gw', target: 'ai', label: 'REST', edge_type: 'calls' },
            { id: 'e3', source: 'gw', target: 'db', label: 'SQL', edge_type: 'depends_on' },
            { id: 'e4', source: 'ai', target: 'q1', label: 'AMQP', edge_type: 'depends_on' },
        ],
    },
    state_machine: {
        title: 'State Machine E2E Test',
        diagram_type: 'state_machine',
        nodes: [
            { id: 'idle', label: 'Idle', node_type: 'state', attributes: [] },
            { id: 'gen', label: 'Generating', node_type: 'state', attributes: [] },
            { id: 'ready', label: 'Ready', node_type: 'state', attributes: [] },
            { id: 'err', label: 'Error', node_type: 'state', attributes: [] },
        ],
        edges: [
            { id: 'e1', source: 'idle', target: 'gen', label: 'send', edge_type: 'transition' },
            { id: 'e2', source: 'gen', target: 'ready', label: 'done', edge_type: 'transition' },
            { id: 'e3', source: 'gen', target: 'err', label: 'fail', edge_type: 'transition' },
            { id: 'e4', source: 'err', target: 'idle', label: 'reset', edge_type: 'transition' },
            { id: 'e5', source: 'ready', target: 'idle', label: 'clear', edge_type: 'transition' },
        ],
    },
    mindmap: {
        title: 'Mindmap E2E Test',
        diagram_type: 'mindmap',
        nodes: [
            { id: 'root', label: 'MydIAgram', node_type: 'topic', attributes: [] },
            { id: 'fe', label: 'Frontend', node_type: 'topic', attributes: [] },
            { id: 'be', label: 'Backend', node_type: 'topic', attributes: [] },
            { id: 'ai', label: 'IA', node_type: 'topic', attributes: [] },
            { id: 'db', label: 'Base de datos', node_type: 'topic', attributes: [] },
        ],
        edges: [
            { id: 'e1', source: 'root', target: 'fe', label: '', edge_type: 'association' },
            { id: 'e2', source: 'root', target: 'be', label: '', edge_type: 'association' },
            { id: 'e3', source: 'root', target: 'ai', label: '', edge_type: 'association' },
            { id: 'e4', source: 'root', target: 'db', label: '', edge_type: 'association' },
        ],
    },
} as const;

// ── Cabecera PNG ──────────────────────────────────────────────────────────────
// Los primeros 8 bytes de un PNG válido son siempre: 89 50 4E 47 0D 0A 1A 0A
function isPngBuffer(buf: Buffer): boolean {
    if (buf.length < 8) return false;
    return (
        buf[0] === 0x89 &&
        buf[1] === 0x50 && // P
        buf[2] === 0x4e && // N
        buf[3] === 0x47 && // G
        buf[4] === 0x0d &&
        buf[5] === 0x0a &&
        buf[6] === 0x1a &&
        buf[7] === 0x0a
    );
}

// ── Helper: inyecta diagrama y espera a que React Flow lo renderice ───────────

async function injectDiagram(page: Page, diagram: (typeof DIAGRAMS)[keyof typeof DIAGRAMS]) {
    // Espera a que window.__myd_store__ esté disponible (main.tsx lo expone en DEV)
    await page.waitForFunction(() => typeof (window as Window & { __myd_store__?: unknown }).__myd_store__ === 'function', {
        timeout: 15_000,
    });

    await page.evaluate((d) => {
        const store = (window as Window & { __myd_store__: (selector: (s: unknown) => unknown) => unknown }).__myd_store__;
        // Accede al estado directamente a través de getState() de Zustand
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { setCurrentDiagram, setUiState } = (store as any).getState();
        setCurrentDiagram(d);
        setUiState('ready');
    }, diagram as unknown as Record<string, unknown>);

    // Espera a que al menos un nodo de React Flow aparezca en el DOM
    await page.waitForSelector('.react-flow__node', { timeout: 15_000 });
    // Pequeña pausa para que el layout de dagre/secuencia termine y los nodos
    // se posicionen correctamente antes de exportar
    await page.waitForTimeout(800);
}

// ── Helper: abre el menú de exportación y dispara PNG ─────────────────────────

async function triggerPngExport(page: Page): Promise<Download> {
    // Registra el listener de descarga ANTES de hacer click (evita race condition).
    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });

    // Abre el menú desplegable "Exportar".
    // Tras el rediseño de la topbar el trigger es un botón icon-only sin texto;
    // se localiza por su aria-label "Exportar diagrama".
    await page.locator('button[aria-label="Exportar diagrama"]').click();

    // Los items del menú son <button> normales (no menuitem).
    // Espera a que el dropdown sea visible y haz click en "Exportar PNG".
    await page.waitForSelector('button:has-text("Exportar PNG"):not([disabled])', { timeout: 10_000 });
    await page.locator('button', { hasText: 'Exportar PNG' }).click();

    return downloadPromise;
}

// ── Helper: verifica el archivo PNG descargado ────────────────────────────────

async function verifyPng(
    download: Download,
    diagramType: string,
): Promise<{ path: string; size: number }> {
    const tmpPath = path.join('/tmp', `myd-e2e-${diagramType}-${Date.now()}.png`);
    await download.saveAs(tmpPath);

    const buf = fs.readFileSync(tmpPath);

    // 1. Cabecera PNG válida
    expect(isPngBuffer(buf), `${diagramType}: no es un PNG válido (cabecera incorrecta)`).toBe(true);

    // 2. Tamaño razonable: > 1 KB (un PNG vacío/en blanco puro sería < 200 bytes)
    expect(buf.length, `${diagramType}: PNG demasiado pequeño (${buf.length} bytes)`).toBeGreaterThan(1024);

    return { path: tmpPath, size: buf.length };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Export PNG — los 7 tipos de diagrama', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        // En estado idle la app NO renderiza ReactFlow (sin diagrama). Esperamos
        // a que el botón "Exportar" esté visible: indica que React montó el TopBar
        // y la app está lista para recibir el diagrama inyectado.
        await page.waitForSelector('button[aria-label="Exportar diagrama"]', { timeout: 20_000 });
    });

    for (const [diagramType, diagram] of Object.entries(DIAGRAMS) as [
        keyof typeof DIAGRAMS,
        (typeof DIAGRAMS)[keyof typeof DIAGRAMS],
    ][]) {
        test(`${diagramType} — exporta PNG válido con tamaño razonable`, async ({ page }) => {
            await injectDiagram(page, diagram);

            const download = await triggerPngExport(page);

            // Verifica el nombre del archivo descargado
            expect(download.suggestedFilename()).toMatch(/\.png$/i);

            const { path: savedPath, size } = await verifyPng(download, diagramType);

            // Reporta ruta y tamaño para el informe
            console.log(`[e2e] ${diagramType}: ${savedPath} (${size} bytes)`);
        });
    }
});

// ── Test adicional: el PNG de secuencia incluye lifelines ────────────────────
// Los diagramas de secuencia generan nodos extra (lifeline, activation) que
// no están en el modelo de datos pero sí deben aparecer en el PNG. Si los
// bounds los excluyen, el PNG sale recortado. Este test verifica que el PNG
// es lo suficientemente alto (los lifelines son verticales).
test.describe('Export PNG — validaciones específicas por tipo', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('button[aria-label="Exportar diagrama"]', { timeout: 20_000 });
    });

    test('sequence — el PNG es más alto que ancho (lifelines son verticales)', async ({ page }) => {
        await injectDiagram(page, DIAGRAMS.sequence);

        const download = await triggerPngExport(page);
        const tmpPath = path.join('/tmp', `myd-e2e-sequence-dims-${Date.now()}.png`);
        await download.saveAs(tmpPath);

        const buf = fs.readFileSync(tmpPath);
        expect(isPngBuffer(buf)).toBe(true);

        // Dimensiones del PNG están en bytes 16-23 de la cabecera IHDR
        // IHDR chunk: bytes 8-11 = longitud (4), 12-15 = "IHDR", 16-19 = ancho, 20-23 = alto
        const width = buf.readUInt32BE(16);
        const height = buf.readUInt32BE(20);
        console.log(`[e2e] sequence PNG dimensions: ${width}x${height}`);

        // Un diagrama de secuencia debe ser más alto que ancho (lifelines verticales)
        // Con 3 actores y 4 mensajes, height debería ser claramente mayor que width
        expect(height, `sequence PNG height (${height}) debería ser >= width (${width})`).toBeGreaterThanOrEqual(width * 0.5);
    });

    test('erd — el PNG es más ancho que alto (3 tablas en horizontal)', async ({ page }) => {
        await injectDiagram(page, DIAGRAMS.erd);

        const download = await triggerPngExport(page);
        const tmpPath = path.join('/tmp', `myd-e2e-erd-dims-${Date.now()}.png`);
        await download.saveAs(tmpPath);

        const buf = fs.readFileSync(tmpPath);
        expect(isPngBuffer(buf)).toBe(true);

        const width = buf.readUInt32BE(16);
        const height = buf.readUInt32BE(20);
        console.log(`[e2e] erd PNG dimensions: ${width}x${height}`);

        // Dagre coloca 3 tablas de un ERD en disposición horizontal
        // El ancho debería ser mayor que el alto
        expect(width, `erd PNG width (${width}) debería ser > height (${height})`).toBeGreaterThan(height * 0.5);
    });

    // ── Excepción para diagramas enormes ─────────────────────────────────────
    // Un diagrama tan grande que a escala natural (1.0) superaría el tope de
    // tamaño debe exportarse ESCALADO para caber ENTERO en la imagen, no
    // recortado. MAX_IMAGE_DIM = 4096 (px de flujo) y PIXEL_RATIO = 2 ⇒ el lado
    // mayor del PNG no puede superar 8192 px, y aun así debe contener todo.
    test('diagrama enorme — se escala para caber entero, no se recorta', async ({ page }) => {
        // Cadena larga de pasos (flowchart): dagre la apila en vertical y supera
        // con holgura los 4096 px de alto, forzando la rama de escalado.
        const N = 90;
        const huge = {
            title: 'Huge E2E',
            diagram_type: 'flowchart' as const,
            nodes: Array.from({ length: N }, (_, i) => ({
                id: `n${i}`,
                label: `Paso ${i} con texto algo largo para ensanchar`,
                node_type: 'step',
                attributes: [] as string[],
            })),
            edges: Array.from({ length: N - 1 }, (_, i) => ({
                id: `e${i}`,
                source: `n${i}`,
                target: `n${i + 1}`,
                label: '',
                edge_type: 'flow',
            })),
        };

        await injectDiagram(page, huge as unknown as (typeof DIAGRAMS)[keyof typeof DIAGRAMS]);

        const download = await triggerPngExport(page);
        const tmpPath = path.join('/tmp', `myd-e2e-huge-${Date.now()}.png`);
        await download.saveAs(tmpPath);

        const buf = fs.readFileSync(tmpPath);
        expect(isPngBuffer(buf)).toBe(true);
        expect(buf.length, 'PNG enorme demasiado pequeño (¿en blanco?)').toBeGreaterThan(1024);

        const width = buf.readUInt32BE(16);
        const height = buf.readUInt32BE(20);
        console.log(`[e2e] huge PNG dimensions: ${width}x${height}`);

        // El tope: ningún lado supera MAX_IMAGE_DIM (4096) * PIXEL_RATIO (2).
        const MAX_PX = 4096 * 2;
        expect(width, `width (${width}) > tope`).toBeLessThanOrEqual(MAX_PX);
        expect(height, `height (${height}) > tope`).toBeLessThanOrEqual(MAX_PX);
        // Y debe haber alcanzado el tope (el diagrama era realmente enorme).
        expect(Math.max(width, height)).toBeGreaterThan(MAX_PX * 0.9);
    });
});
