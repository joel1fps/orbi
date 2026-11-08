import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string };

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
    // Settings shows the version from package.json, never a hand-written one.
    define: { __APP_VERSION__: JSON.stringify(version) },
    build: {
      minify: true,
      // three.js only ships in the lazily loaded 3D chunk.
      chunkSizeWarningLimit: 1000,
    },
  },
});
