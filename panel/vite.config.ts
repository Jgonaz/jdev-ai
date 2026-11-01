import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// El servidor de la API escucha en 127.0.0.1; en desarrollo Vite le reenvía
// /api y /ws. El token viaja en la cookie que el servidor fija al abrir la URL
// con ?token=, así que en desarrollo hay que abrir primero esa URL del servidor.
const apiTarget = process.env.JDEV_PANEL_API ?? 'http://127.0.0.1:4317';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/ws': { target: apiTarget, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // xterm.js pesa ~300 kB y la aplicación se sirve en local: no merece dividir el bundle.
    chunkSizeWarningLimit: 900,
  },
  test: {
    // Las pruebas del cliente que necesitan DOM lo piden con «@vitest-environment happy-dom».
    include: ['server/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
