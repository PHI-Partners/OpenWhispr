import { existsSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTempDir } from '../../../tests/helpers/tempDir';
import {
  computeScriptedSha256,
  createFakeModelHost,
  type FakeModelHostInstance,
  generateScriptedBytes,
} from '../../../tests/fakes/fake-model-host.mjs';
import type { WhisperModel } from '@shared/whisperModels';
import { type DownloadProgressFrame, ModelDownloader, ModelDownloaderError } from './modelDownloader';

describe('ModelDownloader', () => {
  let tempDir: string;
  let host: FakeModelHostInstance;

  const TEST_MODEL_LENGTH = 16 * 1024; // 16 KB
  const TEST_SHA256 = computeScriptedSha256(TEST_MODEL_LENGTH);

  const testModel: WhisperModel = {
    name: 'tiny.en',
    fileName: 'ggml-tiny.en.bin',
    description: 'Test tiny English model',
    expectedSizeBytes: TEST_MODEL_LENGTH,
    sha256: TEST_SHA256,
  };

  beforeAll(async () => {
    host = await createFakeModelHost({ length: TEST_MODEL_LENGTH });
  });

  afterAll(async () => {
    await host.close();
  });

  beforeEach(async () => {
    tempDir = await makeTempDir();
    host.setBehavior('normal');
    host.setLength(TEST_MODEL_LENGTH);
    ModelDownloader.resetGlobalLock();
  });

  afterEach(() => {
    ModelDownloader.resetGlobalLock();
    vi.useRealTimers();
  });

  // ── 1. Happy path ──

  it('happy path writes the file, matches hash, and leaves no .tmp file', async () => {
    const frames: DownloadProgressFrame[] = [];
    const downloader = new ModelDownloader({
      modelsDir: tempDir,
      baseUrl: host.url,
      onProgress: (frame) => frames.push(frame),
    });

    const finalPath = await downloader.download(testModel);

    expect(existsSync(finalPath)).toBe(true);
    expect(existsSync(`${finalPath}.tmp`)).toBe(false);

    const content = readFileSync(finalPath);
    expect(content.length).toBe(TEST_MODEL_LENGTH);
    expect(content.equals(generateScriptedBytes(TEST_MODEL_LENGTH))).toBe(true);

    // Verify progress frames
    expect(frames.length).toBeGreaterThan(0);
    const terminalFrame = frames[frames.length - 1];
    expect(terminalFrame.type).toBe('complete');
    expect(terminalFrame.percentage).toBe(100);
    expect(terminalFrame.downloadedBytes).toBe(TEST_MODEL_LENGTH);

    // After completion, activeDownload should be null
    expect(downloader.activeDownload()).toBeNull();
  });

  // ── 2. Resume after connection truncation ──

  it('resume after a truncated connection continues from the byte offset', async () => {
    // Truncate connection after 4096 bytes on first attempt, then return 206 normal on retry
    host.setBehavior('truncate-once:4096');

    const frames: DownloadProgressFrame[] = [];
    const downloader = new ModelDownloader({
      modelsDir: tempDir,
      baseUrl: host.url,
      retryBackoffCapMs: 10,
      onProgress: (frame) => frames.push(frame),
    });

    const finalPath = await downloader.download(testModel);

    expect(existsSync(finalPath)).toBe(true);
    expect(existsSync(`${finalPath}.tmp`)).toBe(false);

    const content = readFileSync(finalPath);
    expect(content.length).toBe(TEST_MODEL_LENGTH);
    expect(content.equals(generateScriptedBytes(TEST_MODEL_LENGTH))).toBe(true);
  });

  // ── 3. Host without Range support restarts cleanly ──

  it('restarts cleanly from zero if host ignores Range and answers 200', async () => {
    // Seed a partial .tmp file of 4096 bytes
    const tmpPath = join(tempDir, `${testModel.fileName}.tmp`);
    writeFileSync(tmpPath, generateScriptedBytes(4096));

    host.setBehavior('range-ignored');

    const downloader = new ModelDownloader({
      modelsDir: tempDir,
      baseUrl: host.url,
      retryBackoffCapMs: 10,
    });

    const finalPath = await downloader.download(testModel);

    expect(existsSync(finalPath)).toBe(true);
    expect(existsSync(tmpPath)).toBe(false);

    const content = readFileSync(finalPath);
    expect(content.length).toBe(TEST_MODEL_LENGTH);
    expect(content.equals(generateScriptedBytes(TEST_MODEL_LENGTH))).toBe(true);
  });

  // ── 4. Stall abort ──

  it('aborts and retries on no-data stall timeout', async () => {
    // Stall immediately without sending data
    host.setBehavior('stalled:0');

    const downloader = new ModelDownloader({
      modelsDir: tempDir,
      baseUrl: host.url,
      stallTimeoutMs: 50,
      retryBackoffCapMs: 10,
      maxRetries: 2,
    });

    await expect(downloader.download(testModel)).rejects.toThrow(/stalled/i);
  });

  it('stall abort triggers under fake timers for default 30s timeout', async () => {
    vi.useFakeTimers();

    const originalFetch = globalThis.fetch;
    let notifyFetchCalled: () => void = () => {};
    const fetchCalledPromise = new Promise<void>((resolve) => {
      notifyFetchCalled = resolve;
    });

    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: { signal?: AbortSignal }) => {
      notifyFetchCalled();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener('abort', () => {
            try {
              controller.error(init.signal?.reason);
            } catch {
              // ignore
            }
          });
        },
      });
      return Promise.resolve({
        ok: true,
        status: 200,
        body: stream,
        headers: new Headers(),
      } as unknown as Response);
    });

    try {
      const downloader = new ModelDownloader({
        modelsDir: tempDir,
        baseUrl: host.url,
        stallTimeoutMs: 30_000,
        maxRetries: 0,
        getAvailableDiskSpace: () => Promise.resolve(100_000_000),
      });

      const downloadPromise = downloader.download(testModel);

      // Await until fetch is actually called and stream reading starts
      await fetchCalledPromise;
      await Promise.resolve();
      await Promise.resolve();

      // Now stall timer is armed; advance fake timers past 30s
      await vi.advanceTimersByTimeAsync(30_000);

      await expect(downloadPromise).rejects.toSatisfy((err: unknown) => {
        return err instanceof ModelDownloaderError && err.code === 'DOWNLOAD_STALLED';
      });
    } finally {
      globalThis.fetch = originalFetch;
      vi.useRealTimers();
    }
  });

  // ── 5. Retry / backoff schedule ──

  it('retries on 500 errors and succeeds when server recovers', async () => {
    // Fail first 2 attempts with 500, then succeed on 3rd attempt
    host.setBehavior('500-then-ok:2');

    const downloader = new ModelDownloader({
      modelsDir: tempDir,
      baseUrl: host.url,
      retryBackoffCapMs: 20,
      maxRetries: 3,
    });

    const finalPath = await downloader.download(testModel);
    expect(existsSync(finalPath)).toBe(true);
  });

  // ── 6. 404 / 500 errors leave no .bin ──

  it('404 produces typed NOT_FOUND error and leaves no .bin', async () => {
    host.setBehavior('404');

    const downloader = new ModelDownloader({
      modelsDir: tempDir,
      baseUrl: host.url,
      maxRetries: 3,
    });

    await expect(downloader.download(testModel)).rejects.toSatisfy((err: unknown) => {
      return err instanceof ModelDownloaderError && err.code === 'NOT_FOUND' && err.statusCode === 404;
    });

    const finalPath = join(tempDir, testModel.fileName);
    expect(existsSync(finalPath)).toBe(false);
  });

  it('persistent 500 produces typed SERVER_ERROR error after retries and leaves no .bin', async () => {
    host.setBehavior('500');

    const downloader = new ModelDownloader({
      modelsDir: tempDir,
      baseUrl: host.url,
      retryBackoffCapMs: 10,
      maxRetries: 2,
    });

    await expect(downloader.download(testModel)).rejects.toSatisfy((err: unknown) => {
      return err instanceof ModelDownloaderError && err.code === 'SERVER_ERROR' && err.statusCode === 500;
    });

    const finalPath = join(tempDir, testModel.fileName);
    expect(existsSync(finalPath)).toBe(false);
  });

  // ── 7. Cancel mid-flight removes .tmp ──

  it('cancel mid-flight removes the .tmp file and leaves no .bin', async () => {
    host.setBehavior('slow-trickle:1024:100');

    const downloader = new ModelDownloader({
      modelsDir: tempDir,
      baseUrl: host.url,
      onProgress: (frame) => {
        if (frame.downloadedBytes >= 1024) {
          downloader.cancel();
        }
      },
    });

    await expect(downloader.download(testModel)).rejects.toSatisfy((err: unknown) => {
      return err instanceof ModelDownloaderError && err.code === 'DOWNLOAD_CANCELLED';
    });

    const finalPath = join(tempDir, testModel.fileName);
    const tmpPath = `${finalPath}.tmp`;

    expect(existsSync(finalPath)).toBe(false);
    expect(existsSync(tmpPath)).toBe(false);
  });

  // ── 8. App quit keeps .tmp ──

  it('app quit keeps the partial .tmp file for next resume', async () => {
    host.setBehavior('slow-trickle:1024:100');

    const downloader = new ModelDownloader({
      modelsDir: tempDir,
      baseUrl: host.url,
      onProgress: (frame) => {
        if (frame.downloadedBytes >= 1024) {
          downloader.quit();
        }
      },
    });

    await expect(downloader.download(testModel)).rejects.toSatisfy((err: unknown) => {
      return err instanceof ModelDownloaderError && err.code === 'DOWNLOAD_CANCELLED';
    });

    const finalPath = join(tempDir, testModel.fileName);
    const tmpPath = `${finalPath}.tmp`;

    expect(existsSync(finalPath)).toBe(false);
    expect(existsSync(tmpPath)).toBe(true);
    expect(statSync(tmpPath).size).toBeGreaterThanOrEqual(1024);
  });

  // ── 9. Second concurrent request rejected ──

  it('rejects a second concurrent request with DOWNLOAD_IN_PROGRESS naming active model', async () => {
    host.setBehavior('slow-trickle:1024:150');

    const downloader1 = new ModelDownloader({
      modelsDir: tempDir,
      baseUrl: host.url,
    });
    const downloader2 = new ModelDownloader({
      modelsDir: tempDir,
      baseUrl: host.url,
    });

    const download1Promise = downloader1.download(testModel);

    // Wait until download 1 is active
    await vi.waitFor(() => expect(downloader1.activeDownload()).not.toBeNull());

    // Second download attempt
    const otherModel: WhisperModel = {
      ...testModel,
      name: 'small.en',
      fileName: 'ggml-small.en.bin',
    };

    await expect(downloader2.download(otherModel)).rejects.toSatisfy((err: unknown) => {
      return (
        err instanceof ModelDownloaderError &&
        err.code === 'DOWNLOAD_IN_PROGRESS' &&
        err.activeModel === testModel.name
      );
    });

    downloader1.cancel();
    await expect(download1Promise).rejects.toThrow();
  });

  // ── 10. Disk-space preflight rejection ──

  it('rejects with INSUFFICIENT_DISK_SPACE quoting required and available bytes', async () => {
    const required = Math.ceil(1.2 * testModel.expectedSizeBytes);
    const mockAvailable = required - 1; // 1 byte short

    const downloader = new ModelDownloader({
      modelsDir: tempDir,
      baseUrl: host.url,
      getAvailableDiskSpace: () => Promise.resolve(mockAvailable),
    });

    await expect(downloader.download(testModel)).rejects.toSatisfy((err: unknown) => {
      return (
        err instanceof ModelDownloaderError &&
        err.code === 'INSUFFICIENT_DISK_SPACE' &&
        err.requiredBytes === required &&
        err.availableBytes === mockAvailable
      );
    });

    const finalPath = join(tempDir, testModel.fileName);
    expect(existsSync(finalPath)).toBe(false);
    expect(existsSync(`${finalPath}.tmp`)).toBe(false);
  });

  // ── 11. Hash mismatch catches error and deletes file ──

  it('catches hash mismatch on correctly-sized body and deletes .tmp', async () => {
    host.setBehavior('wrong-content');

    const downloader = new ModelDownloader({
      modelsDir: tempDir,
      baseUrl: host.url,
      retryBackoffCapMs: 10,
    });

    await expect(downloader.download(testModel)).rejects.toSatisfy((err: unknown) => {
      return (
        err instanceof ModelDownloaderError &&
        err.code === 'HASH_MISMATCH' &&
        err.expectedSha256 === testModel.sha256
      );
    });

    const finalPath = join(tempDir, testModel.fileName);
    expect(existsSync(finalPath)).toBe(false);
    expect(existsSync(`${finalPath}.tmp`)).toBe(false);
  });

  // ── 12. Monotonic sequence and progress throttling ──

  it('progress frames are throttled, monotonic and end with exactly one terminal frame', async () => {
    host.setBehavior('slow-trickle:512:20');

    const frames: DownloadProgressFrame[] = [];
    const downloader = new ModelDownloader({
      modelsDir: tempDir,
      baseUrl: host.url,
      throttleMs: 50,
      onProgress: (frame) => frames.push(frame),
    });

    await downloader.download(testModel);

    expect(frames.length).toBeGreaterThan(0);

    // Verify monotonicity of sequence counter
    for (let i = 1; i < frames.length; i += 1) {
      expect(frames[i].sequence).toBeGreaterThan(frames[i - 1].sequence);
    }

    // Exactly one terminal frame, and it is the last frame
    const terminalFrames = frames.filter((f) => f.type === 'complete' || f.type === 'error');
    expect(terminalFrames.length).toBe(1);
    expect(frames[frames.length - 1].type).toBe('complete');
  });

  // ── 13. Stale or oversized .tmp cleanup ──

  it('discards an existing .tmp file that is oversized', async () => {
    const tmpPath = join(tempDir, `${testModel.fileName}.tmp`);
    // Create an oversized .tmp file (larger than expectedSizeBytes)
    writeFileSync(tmpPath, Buffer.alloc(testModel.expectedSizeBytes + 1024));

    const downloader = new ModelDownloader({
      modelsDir: tempDir,
      baseUrl: host.url,
    });

    const finalPath = await downloader.download(testModel);
    expect(existsSync(finalPath)).toBe(true);
    expect(readFileSync(finalPath).length).toBe(testModel.expectedSizeBytes);
  });

  it('discards an existing .tmp file that is older than 24h', async () => {
    const tmpPath = join(tempDir, `${testModel.fileName}.tmp`);
    writeFileSync(tmpPath, generateScriptedBytes(4096));

    // Backdate mtime by 25 hours
    const staleTime = (Date.now() - 25 * 60 * 60 * 1000) / 1000;
    utimesSync(tmpPath, staleTime, staleTime);

    const downloader = new ModelDownloader({
      modelsDir: tempDir,
      baseUrl: host.url,
    });

    const finalPath = await downloader.download(testModel);
    expect(existsSync(finalPath)).toBe(true);
    expect(readFileSync(finalPath).length).toBe(testModel.expectedSizeBytes);
  });

  // ── 14. OW_MODEL_BASE_URL environment variable override ──

  it('downloads using OW_MODEL_BASE_URL environment override when baseUrl is omitted', async () => {
    const originalEnv = process.env.OW_MODEL_BASE_URL;
    process.env.OW_MODEL_BASE_URL = host.url;

    try {
      const downloader = new ModelDownloader({
        modelsDir: tempDir,
      });

      const finalPath = await downloader.download(testModel);
      expect(existsSync(finalPath)).toBe(true);
    } finally {
      if (originalEnv === undefined) {
        delete process.env.OW_MODEL_BASE_URL;
      } else {
        process.env.OW_MODEL_BASE_URL = originalEnv;
      }
    }
  });
});
