import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Keeps the browser on one origin in dev, so there are no CORS or
      // cookie surprises between the page and the socket.
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/health': { target: 'http://localhost:3001', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3001', ws: true, changeOrigin: true },
    },
  },
  optimizeDeps: {
    // Workspace package ships TypeScript source; let Vite transform it
    // instead of trying to pre-bundle it as a published dep.
    exclude: ['@pic-game/shared'],
  },
});
