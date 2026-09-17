import { vi, type Mock } from 'vitest';
import crypto from 'node:crypto';

// ── FakeMediaStreamTrack ──

export class FakeMediaStreamTrack {
  readonly id: string;
  readonly kind: 'audio' | 'video';
  enabled: boolean;
  readyState: 'live' | 'ended';
  onended: (() => void) | null = null;

  private readonly endedListeners = new Set<() => void>();

  constructor(kind: 'audio' | 'video' = 'audio', id?: string) {
    this.id = id ?? crypto.randomUUID();
    this.kind = kind;
    this.enabled = true;
    this.readyState = 'live';
  }

  stop(): void {
    if (this.readyState === 'ended') return;
    this.readyState = 'ended';
    this.onended?.();
    for (const listener of this.endedListeners) listener();
  }

  clone(): FakeMediaStreamTrack {
    const cloned = new FakeMediaStreamTrack(this.kind);
    cloned.enabled = this.enabled;
    return cloned;
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === 'ended') this.endedListeners.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === 'ended') this.endedListeners.delete(listener);
  }

  getSettings(): Record<string, unknown> {
    return {
      deviceId: this.id,
      ...(this.kind === 'audio'
        ? { channelCount: 1, sampleRate: 48000, sampleSize: 16 }
        : { width: 1920, height: 1080, frameRate: 30 }),
    };
  }
}

// ── FakeMediaStream ──

export class FakeMediaStream {
  readonly id: string;
  private readonly tracks: FakeMediaStreamTrack[];

  constructor(tracks: FakeMediaStreamTrack[] = []) {
    this.id = crypto.randomUUID();
    this.tracks = [...tracks];
  }

  get active(): boolean {
    return this.tracks.some((t) => t.readyState === 'live');
  }

  getTracks(): FakeMediaStreamTrack[] {
    return [...this.tracks];
  }

  getAudioTracks(): FakeMediaStreamTrack[] {
    return this.tracks.filter((t) => t.kind === 'audio');
  }

  getVideoTracks(): FakeMediaStreamTrack[] {
    return this.tracks.filter((t) => t.kind === 'video');
  }

  addTrack(track: FakeMediaStreamTrack): void {
    if (!this.tracks.includes(track)) this.tracks.push(track);
  }

  removeTrack(track: FakeMediaStreamTrack): void {
    const idx = this.tracks.indexOf(track);
    if (idx !== -1) this.tracks.splice(idx, 1);
  }
}

// ── FakeMediaRecorder ──

export interface FakeDataAvailableEvent {
  readonly type: 'dataavailable';
  readonly data: Blob;
}

export class FakeMediaRecorder {
  static chunkData: Uint8Array = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);

  readonly stream: FakeMediaStream;
  readonly mimeType: string;
  state: 'inactive' | 'recording' | 'paused' = 'inactive';

  ondataavailable: ((event: FakeDataAvailableEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;

  private timerId: ReturnType<typeof setInterval> | null = null;
  private readonly eventListeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(stream: FakeMediaStream, options?: { mimeType?: string }) {
    this.stream = stream;
    this.mimeType = options?.mimeType ?? 'audio/webm;codecs=opus';
  }

  start(timeslice?: number): void {
    if (this.state === 'recording') return;
    this.state = 'recording';

    if (timeslice != null && timeslice > 0) {
      this.timerId = setInterval(() => {
        this.fireDataAvailable();
      }, timeslice);
    }
  }

  stop(): void {
    if (this.state !== 'recording') return;
    if (this.timerId != null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.state = 'inactive';
    this.fireDataAvailable();
    this.onstop?.();
    this.fireEvent('stop', undefined);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    if (!this.eventListeners.has(type)) this.eventListeners.set(type, new Set());
    this.eventListeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.eventListeners.get(type)?.delete(listener);
  }

  private fireDataAvailable(): void {
    const event: FakeDataAvailableEvent = {
      type: 'dataavailable',
      data: new Blob([FakeMediaRecorder.chunkData]),
    };
    this.ondataavailable?.(event);
    this.fireEvent('dataavailable', event);
  }

  private fireEvent(type: string, event: unknown): void {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      for (const listener of listeners) listener(event);
    }
  }
}

// ── installFakeMediaDevices ──

type GetUserMediaFn = (constraints?: unknown) => Promise<FakeMediaStream>;
type GetDisplayMediaFn = (constraints?: unknown) => Promise<FakeMediaStream>;

export interface InstalledMediaDevices {
  getUserMedia: Mock<GetUserMediaFn>;
  getDisplayMedia: Mock<GetDisplayMediaFn>;
  restore: () => void;
}

export function installFakeMediaDevices(): InstalledMediaDevices {
  const getUserMedia = vi.fn(() =>
    Promise.resolve(new FakeMediaStream([new FakeMediaStreamTrack('audio')])),
  );
  const getDisplayMedia = vi.fn(() =>
    Promise.resolve(new FakeMediaStream([new FakeMediaStreamTrack('video')])),
  );

  const original = Object.getOwnPropertyDescriptor(globalThis.navigator, 'mediaDevices');

  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    value: { getUserMedia, getDisplayMedia },
    configurable: true,
    writable: true,
  });

  return {
    getUserMedia,
    getDisplayMedia,
    restore() {
      if (original) {
        Object.defineProperty(globalThis.navigator, 'mediaDevices', original);
      } else {
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
          value: undefined,
          configurable: true,
          writable: true,
        });
      }
    },
  };
}
