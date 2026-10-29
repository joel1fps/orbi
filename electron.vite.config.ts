import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
      },
    },
    plugins: [react()],
    build: {
      minify: true,
      // three.js only ships in the lazily loaded 3D chunk.
      chunkSizeWarningLimit: 1000,
    },
  },
});
