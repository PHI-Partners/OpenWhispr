import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'main',
          environment: 'node',
          include: [
            'src/main/**/*.{test,spec}.{ts,js}',
            'src/shared/**/*.{test,spec}.{ts,js}',
            'scripts/**/*.{test,spec}.{ts,mjs,js}',
            'tests/**/*.{test,spec}.{ts,js}',
          ],
          exclude: ['tests/e2e/**'],
        },
        resolve: {
          alias: {
            '@shared': resolve(import.meta.dirname, 'src/shared'),
          },
        },
      },
      {
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['src/renderer/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.tsx'],
          setupFiles: ['./tests/setup/renderer.ts'],
        },
        resolve: {
          alias: {
            '@shared': resolve(import.meta.dirname, 'src/shared'),
            '@': resolve(import.meta.dirname, 'src/renderer/src'),
          },
        },
      },
    ],
    coverage: {
      provider: 'v8',
    },
  },
});
