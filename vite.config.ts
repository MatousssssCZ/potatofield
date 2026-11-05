import { defineConfig } from 'vite';

// PF_BASE: cesta webu (GitHub Pages projektu = /<repozitář>/); lokálně a jinde „/“.
export default defineConfig({
  base: process.env.PF_BASE ?? '/',
  server: { host: true, port: 5173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000, rollupOptions: { input: { main: 'index.html', viewer: 'viewer.html', characters: 'characters.html' } } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 20000 },
} as never);
