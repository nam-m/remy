/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { devApi } from './scripts/devApi.ts'

// https://vite.dev/config/
export default defineConfig({
  // API keys and flags live in env/ (copy env/.env.example to env/.env.local), not the project root.
  envDir: 'env',
  // devApi serves the functions in api/ during `npm run dev`; it does nothing in a build.
  plugins: [react(), devApi()],
  test: {
    environment: 'jsdom',
    // The whole suite runs in parallel, which can push a slow async test past the 5 s default.
    testTimeout: 20_000,
    setupFiles: ['./src/test/setup.ts'],
  },
})
