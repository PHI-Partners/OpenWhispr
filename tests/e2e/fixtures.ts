import { test as base, _electron, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLOSE_TIMEOUT = 5_000;

type Fixtures = {
  app: ElectronApplication;
  mainWindow: Page;
  consoleErrors: string[];
};

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  app: async ({}, use, testInfo) => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-e2e-'));
    const mainScript = resolve('out/main/index.js');
    const fakeAudioFile = resolve('tests/fixtures/jfk.wav');
    const fakeServerScript = resolve('tests/fakes/fake-whisper-server.mjs');

    const app = await _electron.launch({
      args: [
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${fakeAudioFile}`,
        mainScript,
      ],
      env: {
        ...process.env,
        OW_USER_DATA_DIR: tempDir,
        OW_WHISPER_SERVER_CMD: `node ${fakeServerScript}`,
        OW_CHUNK_SECONDS: '5',
        OW_DISABLE_UPDATER: '1',
      },
    });

    const context = app.context();
    await context.tracing.start({ screenshots: true, snapshots: true });

    await use(app);

    const failed = testInfo.status !== testInfo.expectedStatus;
    if (failed) {
      const page = app.windows()[0];
      if (page) {
        await page
          .screenshot({ path: testInfo.outputPath('failure.png') })
          .catch(() => {});
      }
      await context.tracing
        .stop({ path: testInfo.outputPath('trace.zip') })
        .catch(() => {});
    } else {
      await context.tracing.stop().catch(() => {});
    }

    const proc = app.process();
    await Promise.race([
      app.close().catch(() => {}),
      new Promise<void>((r) => setTimeout(r, CLOSE_TIMEOUT)),
    ]);
    if (proc.exitCode === null && !proc.killed) {
      proc.kill();
    }

    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  },

  mainWindow: async ({ app }, use) => {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await use(page);
  },

  consoleErrors: async ({ mainWindow }, use) => {
    const errors: string[] = [];
    mainWindow.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await use(errors);
  },
});

export { expect };
