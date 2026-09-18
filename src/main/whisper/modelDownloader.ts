import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fsPromises } from 'node:fs';
import { join } from 'node:path';
import {
  DOWNLOAD_STALL_TIMEOUT_MS,
  FREE_DISK_HEADROOM_FACTOR,
  RETRY_BACKOFF_CAP_MS,
  TMP_REAP_AGE_MS,
  readModelBaseUrl,
} from '../config';
import { HF_REVISION, type WhisperModel, type WhisperModelName, WHISPER_MODELS } from '@shared/whisperModels';

export const DEFAULT_MODEL_BASE_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/${HF_REVISION}`;

export type ModelDownloaderErrorCode =
  | 'DOWNLOAD_IN_PROGRESS'
  | 'INSUFFICIENT_DISK_SPACE'
  | 'HASH_MISMATCH'
  | 'NOT_FOUND'
  | 'SERVER_ERROR'
  | 'HTTP_ERROR'
  | 'DOWNLOAD_CANCELLED'
  | 'DOWNLOAD_STALLED'
  | 'UNKNOWN_MODEL';

export class ModelDownloaderError extends Error {
  readonly code: ModelDownloaderErrorCode;
  readonly activeModel?: WhisperModelName;
  readonly requiredBytes?: number;
  readonly availableBytes?: number;
  readonly expectedSha256?: string;
  readonly actualSha256?: string;
  readonly statusCode?: number;

  constructor(
    code: ModelDownloaderErrorCode,
    message: string,
    details?: {
      activeModel?: WhisperModelName;
      requiredBytes?: number;
      availableBytes?: number;
      expectedSha256?: string;
      actualSha256?: string;
      statusCode?: number;
      cause?: unknown;
    },
  ) {
    super(message, { cause: details?.cause });
    this.name = 'ModelDownloaderError';
    this.code = code;
    this.activeModel = details?.activeModel;
    this.requiredBytes = details?.requiredBytes;
    this.availableBytes = details?.availableBytes;
    this.expectedSha256 = details?.expectedSha256;
    this.actualSha256 = details?.actualSha256;
    this.statusCode = details?.statusCode;
  }
}

export type ProgressFrameType = 'progress' | 'complete' | 'error';

export interface DownloadProgressFrame {
  type: ProgressFrameType;
  model: WhisperModelName;
  downloadedBytes: number;
  totalBytes: number;
  percentage: number;
  sequence: number;
  error?: string;
}

export interface ActiveDownload {
  model: WhisperModelName;
  downloadedBytes: number;
  totalBytes: number;
  percentage: number;
}

export interface ModelDownloaderOptions {
  modelsDir: string;
  baseUrl?: string;
  getAvailableDiskSpace?: (dir: string) => Promise<number>;
  onProgress?: (frame: DownloadProgressFrame) => void;
  stallTimeoutMs?: number;
  retryBackoffCapMs?: number;
  maxRetries?: number;
  throttleMs?: number;
  catalog?: readonly WhisperModel[];
}

async function defaultGetAvailableDiskSpace(dir: string): Promise<number> {
  await fsPromises.mkdir(dir, { recursive: true });
  const stat = await fsPromises.statfs(dir);
  return Number(stat.bavail) * Number(stat.bsize);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err =
        signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason ?? 'Aborted'));
      reject(err);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      const err =
        signal?.reason instanceof Error ? signal.reason : new Error(String(signal?.reason ?? 'Aborted'));
      reject(err);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Global in-flight lock tracking active download model name across all downloader instances. */
let globalActiveModel: WhisperModelName | null = null;

export class ModelDownloader {
  private readonly modelsDir: string;
  private readonly baseUrl: string;
  private readonly getAvailableDiskSpace: (dir: string) => Promise<number>;
  private readonly onProgress?: (frame: DownloadProgressFrame) => void;
  private readonly stallTimeoutMs: number;
  private readonly retryBackoffCapMs: number;
  private readonly maxRetries: number;
  private readonly throttleMs: number;
  private readonly catalog: readonly WhisperModel[];

  private currentActiveDownload: ActiveDownload | null = null;
  private sequence = 0;
  private lastProgressEmitTime = 0;
  private activeAbortController: AbortController | null = null;
  private isCancelled = false;
  private isQuit = false;

  constructor(options: ModelDownloaderOptions) {
    this.modelsDir = options.modelsDir;
    const rawBaseUrl = options.baseUrl ?? readModelBaseUrl() ?? DEFAULT_MODEL_BASE_URL;
    this.baseUrl = rawBaseUrl.replace(/\/+$/, '');
    this.getAvailableDiskSpace = options.getAvailableDiskSpace ?? defaultGetAvailableDiskSpace;
    this.onProgress = options.onProgress;
    this.stallTimeoutMs = options.stallTimeoutMs ?? DOWNLOAD_STALL_TIMEOUT_MS;
    this.retryBackoffCapMs = options.retryBackoffCapMs ?? RETRY_BACKOFF_CAP_MS;
    this.maxRetries = options.maxRetries ?? 3;
    this.throttleMs = options.throttleMs ?? 100;
    this.catalog = options.catalog ?? WHISPER_MODELS;
  }

  activeDownload(): ActiveDownload | null {
    return this.currentActiveDownload ? { ...this.currentActiveDownload } : null;
  }

  static resetGlobalLock(): void {
    globalActiveModel = null;
  }

  cancel(): void {
    if (!this.currentActiveDownload) return;
    this.isCancelled = true;
    this.activeAbortController?.abort(
      new ModelDownloaderError('DOWNLOAD_CANCELLED', 'Download cancelled by user'),
    );
  }

  quit(): void {
    if (!this.currentActiveDownload) return;
    this.isQuit = true;
    this.activeAbortController?.abort(
      new ModelDownloaderError('DOWNLOAD_CANCELLED', 'Download aborted on application quit'),
    );
  }

  async download(modelOrName: WhisperModelName | WhisperModel): Promise<string> {
    const model: WhisperModel | undefined =
      typeof modelOrName === 'string' ? this.catalog.find((m) => m.name === modelOrName) : modelOrName;

    if (!model) {
      const name = typeof modelOrName === 'string' ? modelOrName : modelOrName.name;
      throw new ModelDownloaderError('UNKNOWN_MODEL', `Unknown model "${name}" not found in catalog`);
    }

    // 1. One download in flight globally
    if (globalActiveModel !== null) {
      throw new ModelDownloaderError(
        'DOWNLOAD_IN_PROGRESS',
        `Download already in progress for model "${globalActiveModel}"`,
        { activeModel: globalActiveModel },
      );
    }

    // Acquire lock
    globalActiveModel = model.name;
    this.isCancelled = false;
    this.isQuit = false;
    this.lastProgressEmitTime = 0;

    const tmpPath = join(this.modelsDir, `${model.fileName}.tmp`);
    const finalPath = join(this.modelsDir, model.fileName);

    try {
      // 2. Preflight free-disk check (1.2 × expectedSizeBytes)
      const requiredBytes = Math.ceil(FREE_DISK_HEADROOM_FACTOR * model.expectedSizeBytes);
      const availableBytes = await this.getAvailableDiskSpace(this.modelsDir);

      if (availableBytes < requiredBytes) {
        throw new ModelDownloaderError(
          'INSUFFICIENT_DISK_SPACE',
          `Insufficient disk space for model "${model.name}": required ${requiredBytes} bytes, available ${availableBytes} bytes`,
          { requiredBytes, availableBytes },
        );
      }

      await fsPromises.mkdir(this.modelsDir, { recursive: true });

      // 3. Inspect existing .tmp file
      let existingBytes = 0;
      try {
        const stat = await fsPromises.stat(tmpPath);
        const ageMs = Date.now() - stat.mtimeMs;
        if (stat.size > model.expectedSizeBytes || ageMs > TMP_REAP_AGE_MS) {
          // Discard oversized or stale partial file
          await fsPromises.unlink(tmpPath).catch(() => {});
          existingBytes = 0;
        } else {
          existingBytes = stat.size;
        }
      } catch {
        existingBytes = 0;
      }

      this.currentActiveDownload = {
        model: model.name,
        downloadedBytes: existingBytes,
        totalBytes: model.expectedSizeBytes,
        percentage: this.calculatePercentage(existingBytes, model.expectedSizeBytes),
      };

      // 4. Download body with retries and exponential backoff
      await this.downloadWithRetries(model, tmpPath, existingBytes);

      // 5. SHA-256 verification
      const actualSha256 = await this.computeFileSha256(tmpPath);
      if (actualSha256 !== model.sha256) {
        // Discard corrupt temporary file
        await fsPromises.unlink(tmpPath).catch(() => {});
        throw new ModelDownloaderError(
          'HASH_MISMATCH',
          `SHA-256 mismatch for model "${model.name}": expected ${model.sha256}, got ${actualSha256}`,
          { expectedSha256: model.sha256, actualSha256 },
        );
      }

      // 6. Atomic rename .tmp to <fileName>
      await fsPromises.rename(tmpPath, finalPath);

      // 7. Emit terminal complete frame
      this.emitTerminalFrame({
        type: 'complete',
        model: model.name,
        downloadedBytes: model.expectedSizeBytes,
        totalBytes: model.expectedSizeBytes,
        percentage: 100,
        sequence: ++this.sequence,
      });

      return finalPath;
    } catch (err) {
      // If cancelled, remove the partial .tmp file; if quit, keep it intact
      if (this.isCancelled) {
        await fsPromises.unlink(tmpPath).catch(() => {});
      }

      const errorMessage = err instanceof Error ? err.message : String(err);
      this.emitTerminalFrame({
        type: 'error',
        model: model.name,
        downloadedBytes: this.currentActiveDownload?.downloadedBytes ?? 0,
        totalBytes: model.expectedSizeBytes,
        percentage: this.currentActiveDownload?.percentage ?? 0,
        sequence: ++this.sequence,
        error: errorMessage,
      });

      throw err;
    } finally {
      this.currentActiveDownload = null;
      globalActiveModel = null;
      this.activeAbortController = null;
    }
  }

  private async downloadWithRetries(
    model: WhisperModel,
    tmpPath: string,
    initialOffset: number,
  ): Promise<void> {
    let offset = initialOffset;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      this.activeAbortController = new AbortController();

      try {
        await this.streamAttempt(model, tmpPath, offset, this.activeAbortController.signal);
        return; // Success
      } catch (err) {
        if (this.isCancelled || this.isQuit) {
          throw err;
        }

        // Positive list: only these codes are retryable. Any other ModelDownloaderError
        // (NOT_FOUND, HTTP_ERROR, etc.) is non-retryable by default.
        if (err instanceof ModelDownloaderError) {
          const retryable = err.code === 'SERVER_ERROR' || err.code === 'DOWNLOAD_STALLED';
          if (!retryable) throw err;
        }

        if (attempt >= this.maxRetries) {
          throw err;
        }

        // Determine current bytes on disk to resume from on next attempt
        try {
          const stat = await fsPromises.stat(tmpPath);
          if (stat.size >= model.expectedSizeBytes) {
            // Full-size but the attempt still failed: the file is corrupt. Discard and
            // restart fresh instead of resuming from an offset that skips the download.
            await fsPromises.unlink(tmpPath).catch(() => {});
            offset = 0;
          } else {
            offset = stat.size;
          }
        } catch {
          offset = 0;
        }

        // Exponential backoff capped at retryBackoffCapMs
        const backoffMs = Math.min(1_000 * Math.pow(2, attempt), this.retryBackoffCapMs);
        const sleepController = new AbortController();
        this.activeAbortController = sleepController;
        await sleep(backoffMs, sleepController.signal);
      }
    }
  }

  private async streamAttempt(
    model: WhisperModel,
    tmpPath: string,
    offset: number,
    signal: AbortSignal,
  ): Promise<void> {
    if (offset >= model.expectedSizeBytes) {
      return;
    }

    const url = `${this.baseUrl}/${model.fileName}`;

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
        } else if (this.isCancelled || isStalled) {
          writeStream.once('close', () => resClose());
          writeStream.destroy();
        } else {
          writeStream.end(() => resClose());
        }
      });
    }
  }

  private updateProgress(modelName: WhisperModelName, downloadedBytes: number, totalBytes: number): void {
    const percentage = this.calculatePercentage(downloadedBytes, totalBytes);
    this.currentActiveDownload = {
      model: modelName,
      downloadedBytes,
      totalBytes,
      percentage,
    };

    const now = Date.now();
    if (now - this.lastProgressEmitTime >= this.throttleMs) {
      this.lastProgressEmitTime = now;
      this.sequence += 1;
      this.onProgress?.({
        type: 'progress',
        model: modelName,
        downloadedBytes,
        totalBytes,
        percentage,
        sequence: this.sequence,
      });
    }
  }

  private emitTerminalFrame(frame: DownloadProgressFrame): void {
    this.onProgress?.(frame);
  }

  private calculatePercentage(downloadedBytes: number, totalBytes: number): number {
    if (totalBytes <= 0) return 0;
    const pct = (downloadedBytes / totalBytes) * 100;
    return Math.min(100, Math.round(pct * 10) / 10);
  }

  private async computeFileSha256(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    for await (const chunk of stream) {
      hash.update(chunk as Buffer);
    }
    return hash.digest('hex');
  }
}
