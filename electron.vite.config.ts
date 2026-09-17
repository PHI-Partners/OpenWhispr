import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

const sharedAlias = { '@shared': resolve(__dirname, 'src/shared') };

export default defineConfig({
  main: {
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } },
    resolve: { alias: sharedAlias },
  },
  preload: {
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } },
      // A sandboxed preload can only require('electron'): bundle everything else into the file.
      externalizeDeps: false,
    },
    resolve: { alias: sharedAlias },
  },
  renderer: {
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } } },
    resolve: {
      alias: { ...sharedAlias, '@': resolve(__dirname, 'src/renderer/src') },
    },
    plugins: [react(), tailwindcss()],
  },
});
