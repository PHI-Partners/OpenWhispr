import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { pipeStreamToLogger } from '../childProcessAdapter';
import { SAMPLE_RATE } from '../config';
import type { Logger } from '../logger';

export class FfmpegDecoderError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'FfmpegDecoderError';
    this.code = code;
  }
}

export interface FfmpegDecoderOpts {
  ffmpegPath: string;
  sampleRate?: number;
  logger: Logger;
}

export interface FfmpegDecoderEvents {
  data: [pcm: Buffer];
  error: [err: FfmpegDecoderError];
}

export class FfmpegDecoder extends EventEmitter<FfmpegDecoderEvents> {
  private proc: ChildProcess | null = null;
  private closePromise: Promise<void> | null = null;
  private oddByte: Buffer | null = null;
  private ended = false;

  private readonly ffmpegPath: string;
  private readonly sampleRate: number;
  private readonly logger: Logger;

  constructor(opts: FfmpegDecoderOpts) {
    super();
    this.ffmpegPath = opts.ffmpegPath;
    this.sampleRate = opts.sampleRate ?? SAMPLE_RATE;
    this.logger = opts.logger;
  }

  start(): void {
    const args = [
      '-f', 'matroska',
      '-probesize', '32768',
      '-analyzeduration', '0',
      '-i', 'pipe:0',
      '-af', `aresample=${this.sampleRate}:async=1:first_pts=0`,
      '-ac', '1',
      '-f', 's16le',
      '-acodec', 'pcm_s16le',
      'pipe:1',
    ];

    try {
      this.proc = spawn(this.ffmpegPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emit('error', new FfmpegDecoderError('SPAWN_FAILURE', `Failed to spawn ffmpeg: ${msg}`));
      return;
    }

    this.closePromise = new Promise<void>((resolve, reject) => {
      this.proc!.on('close', (code) => {
        if (code === 0 || code === null) {
          resolve();
        } else {
          reject(new FfmpegDecoderError('NON_ZERO_EXIT', `ffmpeg exited with code ${code}`));
        }
      });
    });
    // Prevent unhandled rejection when the process exits without end() being called
    this.closePromise.catch(() => {});

    this.proc.on('error', (err) => {
      this.emit('error', new FfmpegDecoderError('SPAWN_FAILURE', `ffmpeg process error: ${err.message}`));
    });

    this.proc.stdout!.on('data', (chunk: Buffer) => {
      let buf = chunk;
      if (this.oddByte) {
        buf = Buffer.concat([this.oddByte, buf]);
        this.oddByte = null;
      }
      if (buf.length % 2 !== 0) {
        this.oddByte = Buffer.from(buf.subarray(buf.length - 1));
        buf = buf.subarray(0, buf.length - 1);
      }
      if (buf.length > 0) {
        this.emit('data', buf);
      }
    });

    this.proc.stdin!.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'EPIPE') {
        this.emit('error', new FfmpegDecoderError('EPIPE', 'ffmpeg stdin pipe broken (process may have exited)'));
      }
    });

    pipeStreamToLogger(this.proc.stderr!, this.logger, 'ffmpeg', 'warn');
  }

  write(chunk: Buffer): void {
    if (this.ended) {
      throw new FfmpegDecoderError('WRITE_AFTER_END', 'Cannot write to ffmpeg after end() was called');
    }
    if (!this.proc?.stdin || this.proc.stdin.destroyed) {
      throw new FfmpegDecoderError('WRITE_AFTER_END', 'ffmpeg stdin is not available');
    }
    this.proc.stdin.write(chunk);
  }

  end(): Promise<void> {
    this.ended = true;

    if (!this.proc || !this.closePromise) {
      return Promise.resolve();
    }

    this.proc.stdin!.end();
    return this.closePromise;
  }
}
