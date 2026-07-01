import { defineConfig, mergeConfig } from 'vite'
  import { defineConfig as defineVitestConfig, coverageConfigDefaults } from 'vitest/config'
  import react from '@vitejs/plugin-react'

  export default mergeConfig(
    defineConfig({
      plugins: [react()],
    }),
    defineVitestConfig({
      test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/test/setup.ts'],
        // Excluir los tests e2e de Playwright: los corre "npm run test:e2e", no Vitest
        exclude: ['e2e/**', 'node_modules/**'],
        coverage: {
          provider: 'v8',
          exclude: [
            ...coverageConfigDefaults.exclude,
            // Bootstrap de la app y declaraciones de tipos: sin lógica que ejercitar.
            'src/main.tsx',
            '**/*.d.ts',
            // Primitivos de UI puramente decorativos (sin estado ni lógica): su
            // corrección es visual y se valida en la prueba de sistema, no en unitarias.
            'src/ui/primitives/Spinner.tsx',
            'src/ui/primitives/Badge.tsx',
            'src/ui/primitives/EmptyState.tsx',
          ],
        },
      },
    })
  )