/**
 * e2e/help-catalog.spec.ts
 *
 * Genera el "catálogo de componentes" de la web de ayuda (public/help.html):
 * una captura por cada tipo de diagrama mostrando, renderizados de verdad, todos
 * sus tipos de nodo, sus relaciones y sus extras (grupos de arquitectura,
 * fragmentos de secuencia, subsistema de casos de uso).
 *
 * NO es un test de aserción: produce PNGs en public/help/catalog/.
 *
 * Estrategia (idéntica a help-screenshots.spec.ts, estado simulado, sin backend):
 * - Se inyecta cada diagrama de muestra vía __myd_store__ (expuesto en DEV).
 * - Se recarga la página entre diagramas para que el canvas re-encuadre (fitView)
 *   cada uno como "primer diagrama tras cargar", igual que la vista general.
 * - Se ocultan los overlays del canvas (minimapa, controles, paneles, atribución)
 *   para una lámina limpia, y se captura solo el elemento .react-flow.
 *
 * Uso:  npx playwright test help-catalog
 */

import { test, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const OUT_DIR = path.resolve(process.cwd(), 'public/help/catalog');

// ── Diagramas de muestra ──────────────────────────────────────────────────────
// Cada uno está diseñado para exhibir TODOS los tipos de nodo de su diagrama, una
// variedad representativa de relaciones y sus extras propios.

const SAMPLES: Record<string, unknown> = {
  // ERD — tablas con PK/FK y las tres cardinalidades (la diferencia es semántica:
  // se refleja en la etiqueta de la relación).
  erd: {
    title: 'Tienda online',
    diagram_type: 'erd',
    nodes: [
      { id: 'cli', label: 'Cliente', node_type: 'table', attributes: ['id: INT PK', 'nombre: VARCHAR', 'email: VARCHAR'] },
      { id: 'perf', label: 'Perfil', node_type: 'table', attributes: ['id: INT PK', 'cliente_id: INT FK', 'bio: TEXT'] },
      { id: 'ped', label: 'Pedido', node_type: 'table', attributes: ['id: INT PK', 'cliente_id: INT FK', 'fecha: DATE'] },
      { id: 'prod', label: 'Producto', node_type: 'table', attributes: ['id: INT PK', 'nombre: VARCHAR', 'precio: DECIMAL'] },
    ],
    edges: [
      { id: 'r1', source: 'cli', target: 'perf', label: '1 — 1', edge_type: 'one_to_one' },
      { id: 'r2', source: 'cli', target: 'ped', label: '1 — N', edge_type: 'one_to_many' },
      { id: 'r3', source: 'ped', target: 'prod', label: 'N — M', edge_type: 'many_to_many' },
    ],
  },

  // Flujo — inicio/fin (terminator), pasos (step), decisión (decision); aristas de
  // flujo y condicionales (Sí/No).
  flowchart: {
    title: 'Procesar pedido',
    diagram_type: 'flowchart',
    nodes: [
      { id: 'ini', label: 'Inicio', node_type: 'terminator', attributes: [] },
      { id: 's1', label: 'Recibir pedido', node_type: 'step', attributes: [] },
      { id: 'd1', label: '¿Hay stock?', node_type: 'decision', attributes: [] },
      { id: 's2', label: 'Preparar envío', node_type: 'step', attributes: [] },
      { id: 's3', label: 'Avisar al cliente', node_type: 'step', attributes: [] },
      { id: 'fin', label: 'Fin', node_type: 'terminator', attributes: [] },
    ],
    edges: [
      { id: 'f1', source: 'ini', target: 's1', label: '', edge_type: 'flow' },
      { id: 'f2', source: 's1', target: 'd1', label: '', edge_type: 'flow' },
      { id: 'f3', source: 'd1', target: 's2', label: 'Sí', edge_type: 'conditional' },
      { id: 'f4', source: 'd1', target: 's3', label: 'No', edge_type: 'conditional' },
      { id: 'f5', source: 's2', target: 'fin', label: '', edge_type: 'flow' },
      { id: 'f6', source: 's3', target: 'fin', label: '', edge_type: 'flow' },
    ],
  },

  // Arquitectura — los ocho tipos con icono (person, gateway, service, component,
  // database, queue, system, container), repartidos en grupos; aristas calls
  // (sólida) y depends_on (discontinua).
  architecture: {
    title: 'Arquitectura del sistema',
    diagram_type: 'architecture',
    nodes: [
      { id: 'usr', label: 'Usuario', node_type: 'person', attributes: [] },
      { id: 'gw', label: 'API Gateway', node_type: 'gateway', attributes: [] },
      { id: 'auth', label: 'Auth', node_type: 'service', attributes: ['group: Servicios'] },
      { id: 'ord', label: 'Pedidos', node_type: 'service', attributes: ['group: Servicios'] },
      { id: 'val', label: 'Validador', node_type: 'component', attributes: ['group: Servicios'] },
      { id: 'db', label: 'PostgreSQL', node_type: 'database', attributes: ['group: Datos'] },
      { id: 'bus', label: 'Event Bus', node_type: 'queue', attributes: ['group: Datos'] },
      { id: 'k8s', label: 'Kubernetes', node_type: 'system', attributes: ['group: Plataforma'] },
      { id: 'doc', label: 'Docker', node_type: 'container', attributes: ['group: Plataforma'] },
    ],
    edges: [
      { id: 'a1', source: 'usr', target: 'gw', label: '', edge_type: 'calls' },
      { id: 'a2', source: 'gw', target: 'auth', label: '', edge_type: 'calls' },
      { id: 'a3', source: 'gw', target: 'ord', label: '', edge_type: 'calls' },
      { id: 'a4', source: 'ord', target: 'val', label: '', edge_type: 'depends_on' },
      { id: 'a5', source: 'auth', target: 'db', label: '', edge_type: 'depends_on' },
      { id: 'a6', source: 'ord', target: 'bus', label: '', edge_type: 'calls' },
      { id: 'a7', source: 'k8s', target: 'doc', label: '', edge_type: 'depends_on' },
    ],
  },

  // Mapa mental — raíz (root), ramas (branch, una por color) y hojas (leaf, tintadas
  // del color de su rama); relaciones de tipo «rama» (association) en curva.
  mindmap: {
    title: 'Proyecto TFG',
    diagram_type: 'mindmap',
    nodes: [
      { id: 'r', label: 'Proyecto TFG', node_type: 'topic', attributes: [] },
      { id: 'b1', label: 'Frontend', node_type: 'topic', attributes: [] },
      { id: 'b2', label: 'Backend', node_type: 'topic', attributes: [] },
      { id: 'b3', label: 'IA', node_type: 'topic', attributes: [] },
      { id: 'l1', label: 'React Flow', node_type: 'topic', attributes: [] },
      { id: 'l2', label: 'Canvas', node_type: 'topic', attributes: [] },
      { id: 'l3', label: 'Express', node_type: 'topic', attributes: [] },
      { id: 'l4', label: 'Socket.io', node_type: 'topic', attributes: [] },
      { id: 'l5', label: 'LangChain', node_type: 'topic', attributes: [] },
      { id: 'l6', label: 'LLM', node_type: 'topic', attributes: [] },
    ],
    edges: [
      { id: 'm1', source: 'r', target: 'b1', label: '', edge_type: 'association' },
      { id: 'm2', source: 'r', target: 'b2', label: '', edge_type: 'association' },
      { id: 'm3', source: 'r', target: 'b3', label: '', edge_type: 'association' },
      { id: 'm4', source: 'b1', target: 'l1', label: '', edge_type: 'association' },
      { id: 'm5', source: 'b1', target: 'l2', label: '', edge_type: 'association' },
      { id: 'm6', source: 'b2', target: 'l3', label: '', edge_type: 'association' },
      { id: 'm7', source: 'b2', target: 'l4', label: '', edge_type: 'association' },
      { id: 'm8', source: 'b3', target: 'l5', label: '', edge_type: 'association' },
      { id: 'm9', source: 'b3', target: 'l6', label: '', edge_type: 'association' },
    ],
  },

  // Secuencia — actores con su lifeline y activaciones automáticas; mensajes
  // (sequence), respuestas (sequence_reply) y un fragmento combinado alt (if/else).
  sequence: {
    title: 'Inicio de sesión',
    diagram_type: 'sequence',
    nodes: [
      { id: 'u', label: 'Usuario', node_type: 'actor', attributes: [] },
      { id: 'fe', label: 'Frontend', node_type: 'actor', attributes: [] },
      { id: 'be', label: 'Backend', node_type: 'actor', attributes: [] },
    ],
    edges: [
      { id: 'm1', source: 'u', target: 'fe', label: 'envía credenciales', edge_type: 'sequence' },
      { id: 'm2', source: 'fe', target: 'be', label: 'POST /login', edge_type: 'sequence' },
      { id: 'm3', source: 'be', target: 'fe', label: '200 OK + token', edge_type: 'sequence_reply' },
      { id: 'm4', source: 'be', target: 'fe', label: '401 no autorizado', edge_type: 'sequence_reply' },
      { id: 'm5', source: 'fe', target: 'u', label: 'muestra resultado', edge_type: 'sequence_reply' },
    ],
    fragments: [
      {
        id: 'frag1',
        kind: 'alt',
        operands: [
          { guard: 'credenciales válidas', message_ids: ['m3'], child_fragment_ids: [] },
          { guard: 'credenciales incorrectas', message_ids: ['m4'], child_fragment_ids: [] },
        ],
      },
    ],
  },

  // Casos de uso — actores (stick figures), casos de uso (elipses) dentro del
  // subsistema (system); asociación, «include», «extend» y generalización.
  use_case: {
    title: 'Sistema de reservas',
    diagram_type: 'use_case',
    nodes: [
      { id: 'act1', label: 'Cliente', node_type: 'actor', attributes: [] },
      { id: 'act2', label: 'Administrador', node_type: 'actor', attributes: [] },
      { id: 'sys', label: 'Sistema de reservas', node_type: 'system', attributes: [] },
      { id: 'uc1', label: 'Reservar habitación', node_type: 'use_case', attributes: [] },
      { id: 'uc2', label: 'Pagar reserva', node_type: 'use_case', attributes: [] },
      { id: 'uc3', label: 'Aplicar descuento', node_type: 'use_case', attributes: [] },
    ],
    edges: [
      { id: 'u1', source: 'act1', target: 'uc1', label: '', edge_type: 'association' },
      { id: 'u2', source: 'act2', target: 'uc2', label: '', edge_type: 'association' },
      { id: 'u3', source: 'uc1', target: 'uc2', label: '«include»', edge_type: 'include' },
      { id: 'u4', source: 'uc3', target: 'uc2', label: '«extend»', edge_type: 'extend' },
      { id: 'u5', source: 'act2', target: 'act1', label: '', edge_type: 'inherits' },
    ],
  },
};

async function ready(page: Page) {
  await page.waitForFunction(
    () => typeof (window as Window & { __myd_store__?: unknown }).__myd_store__ === 'function',
    { timeout: 15_000 },
  );
}

async function injectAuth(page: Page) {
  await page.waitForFunction(
    () => (window as Window & { __myd_auth__?: { getState: () => { initialized: boolean } } }).__myd_auth__?.getState().initialized === true,
    { timeout: 15_000 },
  ).catch(() => undefined);

  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const auth = (window as any).__myd_auth__;
    auth.getState().setSession({
      access_token: 'fake-token-for-screenshots',
      user: {
        id: '00000000-0000-0000-0000-000000000000',
        email: 'usuario@ejemplo.com',
        user_metadata: { full_name: 'Usuario Ejemplo' },
      },
    });
  });
}

async function hideChrome(page: Page) {
  // Toast de "no se pudo conectar" + badge de conexión (no hay backend en la
  // simulación) y, además, los overlays del canvas: para el catálogo queremos una
  // lámina limpia del diagrama, sin minimapa/controles/panel/atribución.
  await page.addStyleTag({
    content: `
      .fixed.bottom-4.right-4 { display: none !important; }
      span.ml-auto.text-xs.font-mono { display: none !important; }
      .react-flow__minimap,
      .react-flow__controls,
      .react-flow__panel,
      .react-flow__attribution { display: none !important; }
      .absolute.bottom-6.left-0.z-20 { display: none !important; } /* barra de prompt flotante */
    `,
  }).catch(() => undefined);
}

async function injectDiagram(page: Page, diagram: unknown) {
  await page.evaluate((d) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = (window as any).__myd_store__;
    const { setCurrentDiagram, setUiState } = store.getState();
    setCurrentDiagram(d);
    setUiState('ready');
  }, diagram);
  await page.waitForSelector('.react-flow__node', { timeout: 15_000 });
  // Margen para que el layout (dagre/ELK/secuencia) y el re-encuadre terminen.
  await page.waitForTimeout(1400);
}

test('genera el catálogo de componentes', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });

  for (const [type, diagram] of Object.entries(SAMPLES)) {
    // Recarga por diagrama: cada uno se encuadra como "primer diagrama tras cargar".
    await page.goto('/');
    await ready(page);
    await hideChrome(page);
    await injectAuth(page);
    await injectDiagram(page, diagram);

    const canvas = page.locator('.react-flow').first();
    try {
      await canvas.screenshot({ path: path.join(OUT_DIR, `${type}.png`) });
      console.log(`✓ catálogo: ${type}.png`);
    } catch (err) {
      console.warn(`✗ catálogo omitido: ${type}.png — ${(err as Error).message}`);
    }
  }
});
