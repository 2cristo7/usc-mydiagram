import { defineConfig, mergeConfig } from 'vite'
  import { defineConfig as defineVitestConfig } from 'vitest/config'
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
      },
    })
  )