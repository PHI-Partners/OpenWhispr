import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { StartMeetingRecordingResult, RecordingState, RecordingStatePayload } from '@shared/ipc';
import { EventChannel } from '@shared/ipc';
import type { Logger } from '../logger';
import { RecordingSession } from './recordingSession';

export class RecordingControllerError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'RecordingControllerError';
    this.code = code;
  }
}

const DEFAULT_AUDIO_TIMEOUT_MS = 10_000;

export interface RecordingControllerOpts {
  ffmpegPath: string;
  recordingsDir: string;
  sampleRate?: number;
  audioTimeoutMs?: number;
  logger: Logger;
  broadcast: (channel: string, payload: unknown) => void;
}

export class RecordingController {
  private state: RecordingState = 'idle';
  private session: RecordingSession | null = null;
  private sessionId: string | null = null;
  private audioTimer: ReturnType<typeof setTimeout> | null = null;
  private stopPromise: { resolve: () => void; reject: (err: Error) => void } | null = null;

  private readonly ffmpegPath: string;
  private readonly recordingsDir: string;
  private readonly sampleRate: number | undefined;
  private readonly audioTimeoutMs: number;
  private readonly logger: Logger;
  private readonly broadcast: (channel: string, payload: unknown) => void;

  constructor(opts: RecordingControllerOpts) {
    this.ffmpegPath = opts.ffmpegPath;
    this.recordingsDir = opts.recordingsDir;
    this.sampleRate = opts.sampleRate;
    this.audioTimeoutMs = opts.audioTimeoutMs ?? DEFAULT_AUDIO_TIMEOUT_MS;
    this.logger = opts.logger;
    this.broadcast = opts.broadcast;
  }

  start(): StartMeetingRecordingResult {
    if (this.state !== 'idle' && this.state !== 'error') {
      throw new RecordingControllerError(
        'ALREADY_RECORDING',
        `Cannot start: state is "${this.state}"`,
      );
    }

    this.sessionId = randomUUID();
    mkdirSync(this.recordingsDir, { recursive: true });

    const audioPath = join(this.recordingsDir, `recording-${this.sessionId}.wav`);
    this.session = new RecordingSession({
      sessionId: this.sessionId,
      audioPath,
      ffmpegPath: this.ffmpegPath,
      sampleRate: this.sampleRate,
      logger: this.logger,
    });

    this.session.on('completed', () => {
      this.clearAudioTimer();
      this.transition('idle');
      this.stopPromise?.resolve();
      this.stopPromise = null;
    });

    this.session.on('failed', (err) => {
      this.clearAudioTimer();
      this.transition('error');
      this.stopPromise?.reject(err);
      this.stopPromise = null;
    });

    this.session.start();
    this.transition('starting');

    this.audioTimer = setTimeout(() => {
      this.logger.error('recording', `Audio timeout after ${this.audioTimeoutMs}ms`);
      void this.session?.finalize();
      this.transition('error');
    }, this.audioTimeoutMs);

    return { sessionId: this.sessionId, captureSystemAudio: false };
  }

  audioChunk(seq: number, data: Buffer): void {
    if (this.state !== 'starting' && this.state !== 'recording') {
      throw new RecordingControllerError(
        'NOT_RECORDING',
        `Cannot accept audio chunk: state is "${this.state}"`,
      );
    }

    if (this.state === 'starting') {
      this.clearAudioTimer();
      this.transition('recording');
    }

    this.session!.writeChunk(seq, data);
  }

  stop(): Promise<void> {
    if (this.state !== 'starting' && this.state !== 'recording') {
      throw new RecordingControllerError(
        'NOT_RECORDING',
        `Cannot stop: state is "${this.state}"`,
      );
    }

    this.clearAudioTimer();
    this.transition('finalizing');

    return new Promise<void>((resolve, reject) => {
      this.stopPromise = { resolve, reject };
      void this.session!.finalize();
    });
  }

  getState(): RecordingStatePayload {
    return { state: this.state, sessionId: this.sessionId };
  }

  private transition(newState: RecordingState): void {
    this.state = newState;
    this.broadcast(EventChannel.RecordingStateChanged, {
      state: this.state,
      sessionId: this.sessionId,
    });
  }

  private clearAudioTimer(): void {
    if (this.audioTimer) {
      clearTimeout(this.audioTimer);
      this.audioTimer = null;
    }
  }
}
