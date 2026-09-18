import type { Api } from '@shared/ipc';
import type { AudioSourceProvider } from './audioSourceProvider';

export interface CaptureError {
  message: string;
  action?: { label: string; type: 'open-mic-settings' };
}

type CaptureApi = Pick<Api, 'startMeetingRecording' | 'sendAudioChunk' | 'stopMeetingRecording'>;

export class CaptureService {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private nextAssignSeq = 0;
  private nextFlushSeq = 0;
  private readonly pendingChunks = new Map<number, Uint8Array>();
  private inflightCount = 0;
  private drainResolve: (() => void) | null = null;
  private stopped = false;

  private readonly audioSource: AudioSourceProvider;
  private readonly api: CaptureApi;

  constructor(audioSource: AudioSourceProvider, api: CaptureApi) {
    this.audioSource = audioSource;
    this.api = api;
  }

  async start(): Promise<void> {
    await this.api.startMeetingRecording();

    let stream: MediaStream;
    try {
      stream = await this.audioSource.getMicStream();
    } catch (err) {
      await this.api.stopMeetingRecording();
      throw err;
    }
    this.stream = stream;

    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    this.recorder = recorder;

    recorder.ondataavailable = (event: BlobEvent) => {
      this.handleDataAvailable(event);
    };

    recorder.start(1000);
  }

  async stop(): Promise<void> {
    this.stopped = true;

    if (this.recorder && this.recorder.state === 'recording') {
      this.recorder.stop();
    }

    if (this.inflightCount > 0) {
      await new Promise<void>((resolve) => {
        this.drainResolve = resolve;
      });
    }

    this.flushInOrder();
    await this.api.stopMeetingRecording();
    this.cleanup();
  }

  destroy(): void {
    this.stopped = true;
    if (this.recorder && this.recorder.state === 'recording') {
      this.recorder.stop();
    }
    this.cleanup();
  }

  private handleDataAvailable(event: BlobEvent): void {
    if (event.data.size === 0) return;

    const seq = this.nextAssignSeq++;
    this.inflightCount++;

    event.data.arrayBuffer().then(
      (buffer) => {
        this.pendingChunks.set(seq, new Uint8Array(buffer));
        this.inflightCount--;
        this.flushInOrder();
        this.checkDrain();
      },
      () => {
        this.inflightCount--;
        this.checkDrain();
      },
    );
  }

  private flushInOrder(): void {
    while (this.pendingChunks.has(this.nextFlushSeq)) {
      const data = this.pendingChunks.get(this.nextFlushSeq)!;
      this.pendingChunks.delete(this.nextFlushSeq);
      void this.api.sendAudioChunk({ seq: this.nextFlushSeq, data });
      this.nextFlushSeq++;
    }
  }

  private checkDrain(): void {
    if (this.stopped && this.inflightCount === 0 && this.drainResolve) {
      this.drainResolve();
      this.drainResolve = null;
    }
  }

  private cleanup(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
    }
    this.stream = null;
    this.recorder = null;
    this.pendingChunks.clear();
  }
}

export function mapMediaError(err: unknown): CaptureError {
  if (err instanceof DOMException) {
    switch (err.name) {
      case 'NotAllowedError':
        return {
          message: 'Microphone access was denied. Allow access in system settings.',
          action: { label: 'Open Microphone Settings', type: 'open-mic-settings' },
        };
      case 'NotFoundError':
        return { message: 'No microphone found. Connect a microphone and try again.' };
    }
  }
  return {
    message: err instanceof Error ? err.message : 'Failed to access the microphone.',
  };
}
