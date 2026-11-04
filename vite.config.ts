import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: true, port: 5173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000, rollupOptions: { input: { main: 'index.html', viewer: 'viewer.html' } } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 20000 },
} as never);
