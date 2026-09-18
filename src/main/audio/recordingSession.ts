import { EventEmitter } from 'node:events';
import { FfmpegDecoder } from './ffmpegDecoder';
import { WavWriter } from './wavWriter';
import type { Logger } from '../logger';

export class RecordingSessionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'RecordingSessionError';
    this.code = code;
  }
}

export interface RecordingSessionOpts {
  sessionId: string;
  audioPath: string;
  ffmpegPath: string;
  sampleRate?: number;
  logger: Logger;
}

export interface CompletedResult {
  audioPath: string;
  durationSeconds: number;
}

export interface RecordingSessionEvents {
  started: [];
  pcm: [pcm: Buffer];
  completed: [result: CompletedResult];
  failed: [error: Error];
}

export class RecordingSession extends EventEmitter<RecordingSessionEvents> {
  private decoder: FfmpegDecoder | null = null;
  private writer: WavWriter | null = null;
  private nextSeq = 0;
  private failed = false;
  private finalized = false;

  private readonly sessionId: string;
  private readonly audioPath: string;
  private readonly ffmpegPath: string;
  private readonly sampleRate: number | undefined;
  private readonly logger: Logger;

  constructor(opts: RecordingSessionOpts) {
    super();
    this.sessionId = opts.sessionId;
    this.audioPath = opts.audioPath;
    this.ffmpegPath = opts.ffmpegPath;
    this.sampleRate = opts.sampleRate;
    this.logger = opts.logger;
  }

  start(): void {
    this.writer = new WavWriter({ filePath: this.audioPath, sampleRate: this.sampleRate });
    this.decoder = new FfmpegDecoder({
      ffmpegPath: this.ffmpegPath,
      sampleRate: this.sampleRate,
      logger: this.logger,
    });

    this.decoder.on('data', (pcm: Buffer) => {
      this.writer!.write(pcm);
      this.emit('pcm', pcm);
    });

    this.decoder.on('error', (err) => {
      this.handleFailure(err);
    });

    this.decoder.start();
    this.emit('started');
  }

  writeChunk(seq: number, data: Buffer): void {
    if (this.failed) {
      throw new RecordingSessionError('SESSION_FAILED', 'Session has failed');
    }
    if (seq !== this.nextSeq) {
      throw new RecordingSessionError(
        'OUT_OF_ORDER_CHUNK',
        `Expected chunk seq ${this.nextSeq}, got ${seq}`,
      );
    }
    this.decoder!.write(data);
    this.nextSeq++;
  }

  async finalize(): Promise<void> {
    try {
      await this.decoder!.end();
      this.closeWriter();
      this.emit('completed', {
        audioPath: this.audioPath,
        durationSeconds: this.writer!.durationSeconds,
      });
    } catch (err) {
      this.handleFailure(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private handleFailure(err: Error): void {
    if (this.failed) return;
    this.failed = true;
    this.closeWriter();
    this.logger.error('recording-session', `Session ${this.sessionId} failed: ${err.message}`);
    this.emit('failed', err);
  }

  private closeWriter(): void {
    if (this.finalized) return;
    this.finalized = true;
    this.writer?.close();
  }
}
