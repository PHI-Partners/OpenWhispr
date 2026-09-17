import type { Api } from '@shared/ipc';

// A .ts file, not .d.ts: skipLibCheck would silently turn a broken import here into `any`.
declare global {
  interface Window {
    readonly api: Api;
  }
}
