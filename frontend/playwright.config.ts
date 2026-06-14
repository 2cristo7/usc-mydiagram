import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config para tests e2e de exportación PNG.
 * Separado de Vitest: npm run test:e2e (no interfiere con "npm run test").
 *
 * Requiere que el dev server de Vite esté arrancado (baseURL: localhost:5173).
 * El flag webServer lo levanta automáticamente si no está en marcha.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://localhost:5173',
    // Descarga automática — se gestiona en el test con page.waitForEvent('download')
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Levanta el dev server antes de correr los tests y lo mata al terminar.
  // Si el puerto ya está ocupado (servidor ya levantado a mano), reuseExistingServer
  // lo deja pasar sin error.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30_000,
    // No mostrar la salida de Vite en el informe de tests.
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
