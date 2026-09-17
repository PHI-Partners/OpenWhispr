import { test as base, _electron, expect } from '@playwright/test';
import type { ElectronApplication, Page, TestType } from '@playwright/test';
import { existsSync, readdirSync, copyFileSync, mkdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLOSE_TIMEOUT = 5_000;
const WHISPER_BINARY = resolve('resources/bin/cpu/whisper-server.exe');
const MODEL_CACHE_DIR = resolve('.cache/whisper-models');

function findCachedModel(): string | null {
  if (!existsSync(MODEL_CACHE_DIR)) return null;
  const bins = readdirSync(MODEL_CACHE_DIR).filter((f) => f.endsWith('.bin'));
  return bins.length > 0 ? join(MODEL_CACHE_DIR, bins[0]) : null;
}

const hasWhisperBinary = existsSync(WHISPER_BINARY);
const cachedModelPath = findCachedModel();

export function skipWithoutRealBinaries(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: TestType<any, any>,
): void {
  t.skip(
    !hasWhisperBinary,
    `Real whisper-server binary not found at ${WHISPER_BINARY}. Run 'npm run setup:whisper' to provision it.`,
  );
  t.skip(
    !cachedModelPath,
    `No cached model found in ${MODEL_CACHE_DIR}. Run 'npm run setup:whisper -- --model base.en' to download one.`,
  );
}

type Fixtures = {
  app: ElectronApplication;
  mainWindow: Page;
  consoleErrors: string[];
};

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  app: async ({}, use, testInfo) => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-smoke-real-'));
    const mainScript = resolve('out/main/index.js');
    const fakeAudioFile = resolve('tests/fixtures/jfk.wav');

    if (cachedModelPath) {
      const modelsDir = join(tempDir, 'models');
      mkdirSync(modelsDir, { recursive: true });
      const modelFileName = cachedModelPath.split(/[/\\]/).pop()!;
      copyFileSync(cachedModelPath, join(modelsDir, modelFileName));
    }

    const app = await _electron.launch({
      args: [
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${fakeAudioFile}`,
        mainScript,
      ],
      env: {
        ...process.env,
        OW_USER_DATA_DIR: tempDir,
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
        await page.screenshot({ path: testInfo.outputPath('failure.png') }).catch(() => {});
      }
      await context.tracing.stop({ path: testInfo.outputPath('trace.zip') }).catch(() => {});
    } else {
      await context.tracing.stop().catch(() => {});
    }

    const proc = app.process();
    await Promise.race([app.close().catch(() => {}), new Promise<void>((r) => setTimeout(r, CLOSE_TIMEOUT))]);
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
