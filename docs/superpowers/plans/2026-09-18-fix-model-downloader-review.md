# Fix Model Downloader Code Review Findings

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 16 findings from the code review of task 5.1.3 (modelDownloader): 4 CLAUDE.md violations, 5 correctness bugs, 4 design issues, 3 test coverage gaps.

**Architecture:** All changes are in `src/main/whisper/modelDownloader.ts`, its test file, `src/main/config.ts`, `src/shared/whisperModels.ts`, and reverting formatting in two scripts files. No new files created.

**Tech Stack:** TypeScript, Vitest, Node.js `fs`/`crypto`/`stream`

**Spec:** Code review findings documented in conversation. Original spec: `docs/BACKLOG.md` task 5.1.3.

## Global Constraints

- TypeScript 6.0 strict; `@shared/*` alias for imports from `src/shared/` in main-process code
- Vitest 5 with `test.projects`; tests run with `npx vitest run <path>`
- CLAUDE.md: no comments that describe WHAT (only WHY); no reformatting of unrelated files; DRY; only `@shared/` alias in `src/main/`
- All existing tests must remain green after each task
- `npm run typecheck` and `npm run lint` must pass after each task

---

### Task 1: CLAUDE.md Compliance Fixes

**Files:**
- Modify: `scripts/fetch-whisper.mjs` (revert formatting)
- Modify: `scripts/fetch-whisper.test.ts` (revert formatting, add cross-check test)
- Modify: `src/shared/whisperModels.ts` (add `HF_REVISION` export)
- Modify: `src/main/whisper/modelDownloader.ts:1-20,125-197` (fix imports, remove comments, import `HF_REVISION`)
- Modify: `src/main/whisper/modelDownloader.test.ts:11-12` (fix import path)
- Test: existing tests + one new cross-check test

**Interfaces:**
- Produces: `HF_REVISION` exported from `src/shared/whisperModels.ts` — consumed by Task 3 and by `modelDownloader.ts`

- [ ] **Step 1: Revert formatting changes to `scripts/fetch-whisper.mjs`**

Run:
```bash
git checkout HEAD -- scripts/fetch-whisper.mjs
```

These were gratuitous Prettier reformats of a file not in scope for task 5.1.3.

- [ ] **Step 2: Revert formatting changes to `scripts/fetch-whisper.test.ts`**

Run:
```bash
git checkout HEAD -- scripts/fetch-whisper.test.ts
```

Same as above — formatting-only changes violating CLAUDE.md change scope rule.

- [ ] **Step 3: Add `HF_REVISION` to `src/shared/whisperModels.ts`**

Add this export at the top of the file, after the import:

```ts
export const HF_REVISION = '5359861c739e955e79d9a303bcbc70fb988958b1';
```

This becomes the single authoritative source for the Hugging Face revision. The provisioning script (`fetch-whisper.mjs`) keeps its own copy because it's a `.mjs` file that can't import `.ts`, but a cross-check test (step 7) prevents drift.

- [ ] **Step 4: Fix imports and remove duplicate `HF_REVISION` in `modelDownloader.ts`**

Replace the relative import and the duplicated constant:

```ts
// OLD (lines 4-6, 18-19):
import {
  findModel,
  type WhisperModel,
  type WhisperModelName,
  WHISPER_MODELS,
} from '../../shared/whisperModels';

export const HF_REVISION = '5359861c739e955e79d9a303bcbc70fb988958b1';
export const DEFAULT_MODEL_BASE_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/${HF_REVISION}`;

// NEW:
import {
  findModel,
  HF_REVISION,
  type WhisperModel,
  type WhisperModelName,
  WHISPER_MODELS,
} from '@shared/whisperModels';

export const DEFAULT_MODEL_BASE_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/${HF_REVISION}`;
```

`HF_REVISION` is re-exported so existing consumers (if any) don't break.

- [ ] **Step 5: Remove WHAT-describing comments in `modelDownloader.ts`**

Remove JSDoc comments that describe what the method does (the method name already says it). Keep the comment on line 125 (explains the non-obvious global lock design).

Remove:
- Line 125: `/** Global in-flight lock tracking active download model name across all downloader instances. */` — keep this one, it explains WHY it's global
- Lines 157-159: `/** Resets the global active model lock (used for test teardown). */` — remove
- Lines 173-176: `/** Cancels the current download mid-flight.\n   * Deletes any partial .tmp file. */` — remove
- Lines 183-186: `/** Aborts the download on app quit.\n   * Preserves any partial .tmp file on disk for future resumption. */` — remove
- Lines 197-199: `/** Downloads a model by name or WhisperModel descriptor.\n   * Returns the final path to the downloaded .bin file. */` — remove
- Lines 157-159 (`activeDownload` JSDoc): `/** Returns current active download information for state recovery, or null if idle. */` — remove

- [ ] **Step 6: Fix import path in `modelDownloader.test.ts`**

```ts
// OLD (line 12):
import { type DownloadProgressFrame, ModelDownloader, ModelDownloaderError } from './modelDownloader';

// NEW:
import { type DownloadProgressFrame, ModelDownloader, ModelDownloaderError } from '../whisper/modelDownloader';
```

Wait — this test is at `src/main/whisper/modelDownloader.test.ts`, so the relative import `./modelDownloader` is correct for a sibling file. The `@shared` alias applies to imports from `src/shared/`, not within `src/main/`. Keep the relative import for the test importing the implementation — it's in the same directory. Only fix the `whisperModels` import on line 11:

```ts
// OLD (line 11):
import type { WhisperModel } from '../../shared/whisperModels';

// NEW:
import type { WhisperModel } from '@shared/whisperModels';
```

- [ ] **Step 7: Add HF_REVISION cross-check test in `scripts/fetch-whisper.test.ts`**

Add this test inside the existing `'whisperModels.json manifest'` describe block:

```ts
it('HF_REVISION matches the shared whisperModels constant', async () => {
  const { HF_REVISION: sharedRevision } = await import('../src/shared/whisperModels');
  expect(HF_REVISION).toBe(sharedRevision);
});
```

This prevents the two copies from drifting.

- [ ] **Step 8: Run all tests and verify**

```bash
npx vitest run src/main/whisper/modelDownloader.test.ts tests/fakes/fake-model-host.test.ts scripts/fetch-whisper.test.ts --reporter=verbose
npm run typecheck
npm run lint
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/shared/whisperModels.ts src/main/whisper/modelDownloader.ts src/main/whisper/modelDownloader.test.ts scripts/fetch-whisper.mjs scripts/fetch-whisper.test.ts
git commit -m "fix: CLAUDE.md compliance — revert formatting, fix imports, deduplicate HF_REVISION (5.1.3 review)"
```

---

### Task 2: streamAttempt Correctness Fixes

**Files:**
- Modify: `src/main/whisper/modelDownloader.ts:365-487` (streamAttempt method)
- Test: existing tests must pass

**Interfaces:**
- Consumes: no new interfaces
- Produces: no new interfaces (internal method changes)

Five fixes in the `streamAttempt` private method:

1. **Reader never released** — add `reader.cancel()` in finally
2. **No writeStream error handler** — add handler that aborts the controller
3. **Abort race** — throw on `signal.aborted` instead of silent break
4. **Quit path blocks** — use `writeStream.destroy()` when `isQuit`, not just when `isCancelled`
5. **Dead code** — remove `response.status !== 206` from the conditional

- [ ] **Step 1: Replace the streamAttempt method**

Replace the entire `streamAttempt` method (from `private async streamAttempt(` to its closing `}`) with this corrected version:

```ts
  private async streamAttempt(
    model: WhisperModel,
    tmpPath: string,
    offset: number,
    signal: AbortSignal,
  ): Promise<void> {
    if (offset >= model.expectedSizeBytes) {
      return;
    }

    const resolvedBaseUrl = (this.baseUrl ?? readOverrides().modelBaseUrl ?? DEFAULT_MODEL_BASE_URL).replace(/\/+$/, '');
    const url = `${resolvedBaseUrl}/${model.fileName}`;

    const headers: Record<string, string> = {};
    if (offset > 0) {
      headers.Range = `bytes=${offset}-`;
    }

    const response = await fetch(url, { headers, signal });

    if (response.status === 404) {
      throw new ModelDownloaderError(
        'NOT_FOUND',
        `Model file "${model.fileName}" not found at ${url} (HTTP 404)`,
        { statusCode: 404 },
      );
    }

    if (response.status >= 500) {
      throw new ModelDownloaderError(
        'SERVER_ERROR',
        `Server error HTTP ${response.status} downloading "${model.fileName}"`,
        { statusCode: response.status },
      );
    }

    if (!response.ok) {
      throw new ModelDownloaderError(
        'HTTP_ERROR',
        `HTTP error ${response.status} downloading "${model.fileName}"`,
        { statusCode: response.status },
      );
    }

    if (!response.body) {
      throw new ModelDownloaderError('HTTP_ERROR', 'HTTP response body is null');
    }

    const isPartial = response.status === 206;
    let downloadedBytes = isPartial ? offset : 0;
    const fileFlags = isPartial ? 'a' : 'w';

    const writeStream = createWriteStream(tmpPath, { flags: fileFlags });
    writeStream.on('error', (err) => {
      this.activeAbortController?.abort(err);
    });

    let stallTimer: NodeJS.Timeout | null = null;
    let isStalled = false;

    const resetStallTimer = (): void => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        isStalled = true;
        this.activeAbortController?.abort(
          new ModelDownloaderError(
            'DOWNLOAD_STALLED',
            `Download stalled: no data received for ${this.stallTimeoutMs} ms`,
          ),
        );
      }, this.stallTimeoutMs);
    };

    resetStallTimer();

    const reader = (response.body as ReadableStream<Uint8Array>).getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (signal.aborted) {
          throw signal.reason instanceof Error
            ? signal.reason
            : new Error(String(signal.reason ?? 'Download aborted'));
        }

        resetStallTimer();

        if (value && value.length > 0) {
          if (writeStream.destroyed || writeStream.closed) break;
          downloadedBytes += value.length;
          await new Promise<void>((resWrite) => {
            if (!writeStream.write(value)) {
              writeStream.once('drain', () => resWrite());
            } else {
              resWrite();
            }
          });

          this.updateProgress(model.name, downloadedBytes, model.expectedSizeBytes);
        }
      }
    } catch (err) {
      if (isStalled) {
        throw new ModelDownloaderError(
          'DOWNLOAD_STALLED',
          `Download stalled: no data received for ${this.stallTimeoutMs} ms`,
        );
      }
      throw err;
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
      await reader.cancel().catch(() => {});
      await new Promise<void>((resClose) => {
        if (writeStream.closed) {
          resClose();
        } else if (this.isCancelled || this.isQuit || isStalled) {
          writeStream.once('close', () => resClose());
          writeStream.destroy();
        } else {
          writeStream.end(() => resClose());
        }
      });
    }
  }
```

Changes from the original:
- Line `writeStream.on('error', ...)` — prevents `ERR_UNHANDLED_ERROR` crash
- `if (signal.aborted)` now throws instead of silently breaking — prevents HASH_MISMATCH masking DOWNLOAD_CANCELLED
- `reader.cancel().catch(() => {})` in finally — releases the reader lock and frees the TCP connection
- `this.isQuit` added to the destroy condition — prevents blocking process exit
- `!response.ok` replaces `!response.ok && response.status !== 206` — removes dead code
- URL resolution still uses the old fallback chain (Task 3 simplifies this to `this.baseUrl` once the constructor resolves it)

- [ ] **Step 2: Run tests**

```bash
npx vitest run src/main/whisper/modelDownloader.test.ts --reporter=verbose
```

Expected: all 14 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/main/whisper/modelDownloader.ts
git commit -m "fix: streamAttempt correctness — reader cleanup, writeStream error, abort race, quit path (5.1.3 review)"
```

---

### Task 3: download/retry Method Correctness Fixes

**Files:**
- Modify: `src/main/config.ts:44-88` (extract `readModelBaseUrl`)
- Modify: `src/main/whisper/modelDownloader.ts:128-156,200-210,321-363,376` (constructor, download, downloadWithRetries)
- Test: `src/main/whisper/modelDownloader.test.ts` (existing tests)

**Interfaces:**
- Consumes: `HF_REVISION` from `@shared/whisperModels` (Task 1)
- Produces: `readModelBaseUrl(): string | undefined` exported from `src/main/config.ts`

Four fixes:
1. **readOverrides coupling** — extract `readModelBaseUrl()` from `readOverrides()`, resolve URL once in constructor
2. **Catalog fallback** — remove `findModel()` fallback in `download()`
3. **Non-retryable errors** — use positive-list (only retry `SERVER_ERROR` and `DOWNLOAD_STALLED`)
4. **Corrupt .tmp retry** — delete and restart when `.tmp` is full-size but corrupt

- [ ] **Step 1: Extract `readModelBaseUrl()` in `src/main/config.ts`**

Add this function before `readOverrides()`:

```ts
export function readModelBaseUrl(): string | undefined {
  const raw = process.env.OW_MODEL_BASE_URL;
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError('INVALID_OVERRIDE', `OW_MODEL_BASE_URL is not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError(
      'INVALID_OVERRIDE',
      `OW_MODEL_BASE_URL must use http or https, got: ${url.protocol}`,
    );
  }
  return raw;
}
```

Then refactor `readOverrides()` to use it — replace the `let modelBaseUrl` block (lines 59-77) with:

```ts
  const modelBaseUrl = readModelBaseUrl();
```

- [ ] **Step 2: Resolve URL once in the `ModelDownloader` constructor**

In `modelDownloader.ts`, update the import from config and the constructor:

```ts
// In imports, add readModelBaseUrl:
import {
  DOWNLOAD_STALL_TIMEOUT_MS,
  FREE_DISK_HEADROOM_FACTOR,
  RETRY_BACKOFF_CAP_MS,
  TMP_REAP_AGE_MS,
  readModelBaseUrl,
} from '../config';
```

Change the `baseUrl` field from optional to required (it's always resolved):

```ts
  private readonly baseUrl: string;
```

In the constructor, resolve once:

```ts
  constructor(options: ModelDownloaderOptions) {
    this.modelsDir = options.modelsDir;
    const rawBaseUrl = options.baseUrl ?? readModelBaseUrl() ?? DEFAULT_MODEL_BASE_URL;
    this.baseUrl = rawBaseUrl.replace(/\/+$/, '');
    // ... rest unchanged
  }
```

Remove `readOverrides` from the import (no longer needed in this file).

Then in `streamAttempt`, simplify the URL construction. Replace:

```ts
    const resolvedBaseUrl = (this.baseUrl ?? readOverrides().modelBaseUrl ?? DEFAULT_MODEL_BASE_URL).replace(/\/+$/, '');
    const url = `${resolvedBaseUrl}/${model.fileName}`;
```

with:

```ts
    const url = `${this.baseUrl}/${model.fileName}`;
```

The fallback chain and trailing-slash cleanup are now handled once in the constructor.

- [ ] **Step 3: Remove catalog fallback in `download()`**

Replace lines 200-209:

```ts
  // OLD:
  async download(modelOrName: WhisperModelName | WhisperModel): Promise<string> {
    const model: WhisperModel | undefined =
      typeof modelOrName === 'string'
        ? (this.catalog.find((m) => m.name === modelOrName) ?? findModel(modelOrName))
        : modelOrName;

    if (!model) {
      const name = typeof modelOrName === 'string' ? modelOrName : modelOrName.name;
      throw new ModelDownloaderError('UNKNOWN_MODEL', `Unknown model "${name}" not found in catalog`);
    }

  // NEW:
  async download(modelOrName: WhisperModelName | WhisperModel): Promise<string> {
    const model: WhisperModel | undefined =
      typeof modelOrName === 'string'
        ? this.catalog.find((m) => m.name === modelOrName)
        : modelOrName;

    if (!model) {
      const name = typeof modelOrName === 'string' ? modelOrName : modelOrName.name;
      throw new ModelDownloaderError('UNKNOWN_MODEL', `Unknown model "${name}" not found in catalog`);
    }
```

Remove the `findModel` import if no longer used (check first — it may still be used elsewhere in the file). If the only usage was line 203, remove it from the import.

- [ ] **Step 4: Fix non-retryable errors in `downloadWithRetries`**

Replace the non-retryable check (lines 339-342):

```ts
  // OLD:
  if (err instanceof ModelDownloaderError && err.code === 'NOT_FOUND') {
    throw err;
  }

  // NEW:
  if (err instanceof ModelDownloaderError) {
    const retryable = err.code === 'SERVER_ERROR' || err.code === 'DOWNLOAD_STALLED';
    if (!retryable) throw err;
  }
```

This positive-list approach means any new error codes are non-retryable by default (safe).

- [ ] **Step 5: Fix corrupt `.tmp` retry in `downloadWithRetries`**

Replace the offset recovery block (lines 349-354):

```ts
  // OLD:
  try {
    const stat = await fsPromises.stat(tmpPath);
    offset = stat.size <= model.expectedSizeBytes ? stat.size : 0;
  } catch {
    offset = 0;
  }

  // NEW:
  try {
    const stat = await fsPromises.stat(tmpPath);
    if (stat.size >= model.expectedSizeBytes) {
      await fsPromises.unlink(tmpPath).catch(() => {});
      offset = 0;
    } else {
      offset = stat.size;
    }
  } catch {
    offset = 0;
  }
```

When the `.tmp` is at or above the expected size but hash verification failed, delete it and start fresh on the next retry instead of skipping the download.

- [ ] **Step 6: Run tests**

```bash
npx vitest run src/main/whisper/modelDownloader.test.ts --reporter=verbose
npm run typecheck
npm run lint
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/main/config.ts src/main/whisper/modelDownloader.ts
git commit -m "fix: download correctness — resolve URL once, remove catalog fallback, positive-list retries, corrupt .tmp (5.1.3 review)"
```

---

### Task 4: Test Coverage Gaps

**Files:**
- Modify: `src/main/whisper/modelDownloader.test.ts` (add 3 new tests)
- Test: the new tests themselves

**Interfaces:**
- Consumes: `ModelDownloader`, `ModelDownloaderError`, `DownloadProgressFrame` from `./modelDownloader`

- [ ] **Step 1: Add UNKNOWN_MODEL error test**

Add this test after the existing "rejects with INSUFFICIENT_DISK_SPACE" test (around line 372):

```ts
  it('rejects an unknown model name with UNKNOWN_MODEL error', async () => {
    const downloader = new ModelDownloader({
      modelsDir: tempDir,
      baseUrl: host.url,
    });

    await expect(downloader.download('nonexistent' as WhisperModelName)).rejects.toSatisfy(
      (err: unknown) => {
        return err instanceof ModelDownloaderError && err.code === 'UNKNOWN_MODEL';
      },
    );
  });
```

Add `WhisperModelName` to the import from `@shared/whisperModels` if not already there:

```ts
import type { WhisperModel, WhisperModelName } from '@shared/whisperModels';
```

- [ ] **Step 2: Add error terminal frame test**

Add this test after the existing "progress frames are throttled, monotonic" test (around line 424):

```ts
  it('error path emits exactly one terminal frame of type error', async () => {
    host.setBehavior('404');

    const frames: DownloadProgressFrame[] = [];
    const downloader = new ModelDownloader({
      modelsDir: tempDir,
      baseUrl: host.url,
      maxRetries: 0,
      onProgress: (frame) => frames.push(frame),
    });

    await expect(downloader.download(testModel)).rejects.toThrow();

    const terminalFrames = frames.filter((f) => f.type === 'complete' || f.type === 'error');
    expect(terminalFrames).toHaveLength(1);
    expect(terminalFrames[0].type).toBe('error');
    expect(terminalFrames[0].error).toBeDefined();
  });
```

- [ ] **Step 3: Add downloadedBytes monotonicity test**

Add this test after the error terminal frame test:

```ts
  it('progress frames have non-decreasing downloadedBytes', async () => {
    host.setBehavior('slow-trickle:512:20');

    const frames: DownloadProgressFrame[] = [];
    const downloader = new ModelDownloader({
      modelsDir: tempDir,
      baseUrl: host.url,
      throttleMs: 50,
      onProgress: (frame) => frames.push(frame),
    });

    await downloader.download(testModel);

    const progressFrames = frames.filter((f) => f.type === 'progress');
    expect(progressFrames.length).toBeGreaterThan(1);

    for (let i = 1; i < progressFrames.length; i += 1) {
      expect(progressFrames[i].downloadedBytes).toBeGreaterThanOrEqual(
        progressFrames[i - 1].downloadedBytes,
      );
      expect(progressFrames[i].percentage).toBeGreaterThanOrEqual(progressFrames[i - 1].percentage);
    }
  });
```

- [ ] **Step 4: Run the full test suite**

```bash
npx vitest run src/main/whisper/modelDownloader.test.ts tests/fakes/fake-model-host.test.ts scripts/fetch-whisper.test.ts --reporter=verbose
npm run typecheck
npm run lint
```

Expected: all tests pass (26 existing + 3 new = 29 tests in modelDownloader).

- [ ] **Step 5: Commit**

```bash
git add src/main/whisper/modelDownloader.test.ts
git commit -m "test: add coverage for unknown model, error terminal frame, bytes monotonicity (5.1.3 review)"
```
