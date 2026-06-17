/**
 * e2e/help-screenshots.spec.ts
 *
 * Genera las capturas que ilustran la web de ayuda (public/help.html).
 * NO es un test de aserción: su objetivo es producir PNGs en public/help/.
 *
 * Estrategia (estado simulado, sin backend):
 * - main.tsx expone en DEV: __myd_store__ (diagrama), __myd_auth__ (sesión),
 *   __myd_llm__ (modal de configuración).
 * - Inyectamos un diagrama de ejemplo y una sesión Google simulada para poder
 *   abrir menús/modales que de otro modo exigirían login real.
 * - Cada captura va en su propio try/catch: si una falla (p. ej. un panel que
 *   depende del backend), se omite y la página de ayuda muestra un marcador.
 *
 * Uso:  npx playwright test help-screenshots
 */

import { test, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Playwright ejecuta desde la raíz del frontend; el proyecto es ESM (sin __dirname).
const OUT_DIR = path.resolve(process.cwd(), 'public/help');

const SAMPLE_DIAGRAM = {
  title: 'Tienda online',
  diagram_type: 'erd',
  nodes: [
    { id: 'c1', label: 'Clientes', node_type: 'table', attributes: ['id: INT PK', 'nombre: VARCHAR', 'email: VARCHAR'] },
    { id: 'o1', label: 'Pedidos', node_type: 'table', attributes: ['id: INT PK', 'cliente_id: INT FK', 'fecha: DATE'] },
    { id: 'p1', label: 'Productos', node_type: 'table', attributes: ['id: INT PK', 'nombre: VARCHAR', 'precio: DECIMAL'] },
  ],
  edges: [
    { id: 'e1', source: 'c1', target: 'o1', label: 'realiza', edge_type: 'one_to_many' },
    { id: 'e2', source: 'o1', target: 'p1', label: 'incluye', edge_type: 'many_to_many' },
  ],
};

const SAMPLE_MESSAGES = [
  { id: 'm1', sender: 'user', text: 'Una base de datos para una tienda online con clientes, pedidos y productos', timestamp: new Date() },
  { id: 'm2', sender: 'system', text: 'He creado un diagrama entidad-relación con tres tablas: Clientes, Pedidos y Productos.', timestamp: new Date() },
  { id: 'm3', sender: 'user', text: 'Añade una entidad Factura ligada a Pedido', timestamp: new Date() },
  { id: 'm4', sender: 'system', text: 'Hecho: he añadido la entidad Factura con una relación uno-a-muchos desde Pedido.', timestamp: new Date() },
];

async function ready(page: Page) {
  await page.waitForFunction(
    () => typeof (window as Window & { __myd_store__?: unknown }).__myd_store__ === 'function',
    { timeout: 15_000 },
  );
}

async function injectAuth(page: Page) {
  // Espera a que la inicialización real de la sesión termine (initialized=true)
  // y luego sobrescribe con una sesión simulada — así onAuthStateChange ya no la
  // pisa (no vuelve a emitir sin un cambio real de auth).
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

async function injectDiagram(page: Page, withMessages = false) {
  await page.evaluate(({ d, msgs, withMessages }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = (window as any).__myd_store__;
    const { setCurrentDiagram, setUiState } = store.getState();
    setCurrentDiagram(d);
    setUiState('ready');
    if (withMessages) store.setState({ messages: msgs });
  }, { d: SAMPLE_DIAGRAM, msgs: SAMPLE_MESSAGES, withMessages });
  await page.waitForSelector('.react-flow__node', { timeout: 15_000 });
  await page.waitForTimeout(900);
}

async function hideChrome(page: Page) {
  // En la simulación no hay backend ni socket, así que la app muestra un toast de
  // "no se pudo conectar" y un badge "● Error" en el chat. Son ruido para una guía
  // de ayuda: los ocultamos por CSS (persiste frente a re-renders) en vez de
  // descartarlos (el socket reintenta y reaparecen). Solo afecta a las capturas.
  await page.addStyleTag({
    content: `
      .fixed.bottom-4.right-4 { display: none !important; }      /* toaster */
      span.ml-auto.text-xs.font-mono { display: none !important; } /* badge de conexión */
    `,
  }).catch(() => undefined);
}

async function shoot(page: Page, name: string, fn: () => Promise<void>) {
  try {
    await fn();
    await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
    console.log(`✓ captura: ${name}.png`);
  } catch (err) {
    console.warn(`✗ captura omitida: ${name}.png — ${(err as Error).message}`);
  }
}

test('genera capturas de la ayuda', async ({ page }) => {
  test.setTimeout(120_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });

  // 1. Prompt vacío (estado inicial, sin diagrama).
  await page.goto('/');
  await ready(page);
  await hideChrome(page);
  await page.waitForTimeout(1200);
  await shoot(page, 'prompt', async () => {});

  // 2. Vista general con diagrama.
  await injectAuth(page);
  await injectDiagram(page);
  await shoot(page, 'app-overview', async () => {});

  // 3. Edición en el lienzo (selecciona un nodo para mostrar handles/selección).
  await shoot(page, 'canvas-edit', async () => {
    await page.locator('.react-flow__node').first().click();
    await page.waitForTimeout(300);
  });

  // 4. Chat conversacional con mensajes inyectados.
  await page.reload();
  await ready(page);
  await hideChrome(page);
  await injectAuth(page);
  await injectDiagram(page, true);
  await shoot(page, 'chat', async () => {});

  // 5. Menú de exportación abierto.
  await shoot(page, 'export', async () => {
    await page.locator('button[aria-label="Exportar diagrama"]').click();
    await page.waitForTimeout(400);
  });
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(300);

  // 6. Modal de configuración del LLM (abierto vía store). Antes que el historial:
  // ese cajón hace fetch al backend ausente y puede desestabilizar la página.
  await shoot(page, 'llm-modal', async () => {
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__myd_llm__.getState().openModal();
    });
    await page.getByText('Modelo de lenguaje').first().waitFor({ timeout: 6000 });
    await page.waitForTimeout(700);
  });
  // El mismo modal sirve de ilustración para la sección Ollama.
  await shoot(page, 'llm-ollama', async () => {
    await page.waitForTimeout(200);
  });
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(300);

  // 7. Panel "Mis datos y privacidad" (clic real en el menú de perfil).
  await shoot(page, 'privacy-modal', async () => {
    await page.locator('button[aria-label="Mi perfil"]').click({ timeout: 5000 });
    await page.waitForTimeout(200);
    await page.locator('button:has-text("Mis datos y privacidad")').click({ timeout: 4000 });
    await page.waitForSelector('[aria-label="Mis datos y privacidad"]', { timeout: 5000 });
    await page.waitForTimeout(400);
  });
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(300);

  // 8. Cajón de historial — el ÚLTIMO: su fetch al backend ausente puede romper
  // la página (ErrorBoundary), así que no debe afectar a capturas previas.
  await shoot(page, 'history', async () => {
    await page.locator('button[title="Historial"]').first().click({ timeout: 4000 });
    await page.waitForTimeout(600);
  });
});
