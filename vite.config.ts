// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { historyProxy } from './dev/historyProxy.mjs';

export default defineConfig({
  plugins: [react(), {
    name: 'building-sources',
    configureServer(server) { server.middlewares.use(historyProxy); },
    configurePreviewServer(server) { server.middlewares.use(historyProxy); },
  }],
  server: {
    port: 5174,
    proxy: {
      '/api/journeys': {
        // www.codoc.site напрямую — без 301-редиректа, иначе fetch уйдёт
        // на www в обход прокси, и CORS/валидация отвалится.
        target: 'https://www.codoc.site',
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
