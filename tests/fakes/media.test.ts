import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type FakeDataAvailableEvent,
  FakeMediaRecorder,
  FakeMediaStream,
  FakeMediaStreamTrack,
  installFakeMediaDevices,
} from './media';

describe('FakeMediaStreamTrack', () => {
  it('constructs with kind and generates a unique id', () => {
    const track = new FakeMediaStreamTrack('audio');
    expect(track.kind).toBe('audio');
    expect(track.id).toBeTruthy();
    expect(track.enabled).toBe(true);
    expect(track.readyState).toBe('live');
  });

  it('defaults kind to audio', () => {
    const track = new FakeMediaStreamTrack();
    expect(track.kind).toBe('audio');
  });

  it('accepts a custom id', () => {
    const track = new FakeMediaStreamTrack('video', 'custom-id');
    expect(track.id).toBe('custom-id');
  });

  it('stop() transitions readyState to ended', () => {
    const track = new FakeMediaStreamTrack('audio');
    track.stop();
    expect(track.readyState).toBe('ended');
  });

  it('stop() fires onended callback', () => {
    const track = new FakeMediaStreamTrack('audio');
    const handler = vi.fn();
    track.onended = handler;

    track.stop();
    expect(handler).toHaveBeenCalledOnce();
  });

  it('stop() fires addEventListener ended listeners', () => {
    const track = new FakeMediaStreamTrack('audio');
    const handler = vi.fn();
    track.addEventListener('ended', handler);

    track.stop();
    expect(handler).toHaveBeenCalledOnce();
  });

  it('removeEventListener prevents future notification', () => {
    const track = new FakeMediaStreamTrack('audio');
    const handler = vi.fn();
    track.addEventListener('ended', handler);
    track.removeEventListener('ended', handler);

    track.stop();
    expect(handler).not.toHaveBeenCalled();
  });

  it('stop() is idempotent', () => {
    const track = new FakeMediaStreamTrack('audio');
    const handler = vi.fn();
    track.onended = handler;

    track.stop();
    track.stop();
    expect(handler).toHaveBeenCalledOnce();
  });

  it('clone() returns a new track with same kind but fresh id and live state', () => {
    const track = new FakeMediaStreamTrack('video');
    track.stop();
    const cloned = track.clone();

    expect(cloned.kind).toBe('video');
    expect(cloned.id).not.toBe(track.id);
    expect(cloned.readyState).toBe('live');
  });

  it('getSettings() returns kind-specific settings', () => {
    const audio = new FakeMediaStreamTrack('audio');
    expect(audio.getSettings()).toMatchObject({ deviceId: audio.id, channelCount: 1 });

    const video = new FakeMediaStreamTrack('video');
    expect(video.getSettings()).toMatchObject({ deviceId: video.id, width: 1920 });
  });
});

describe('FakeMediaStream', () => {
  it('constructs with tracks and reports active when tracks are live', () => {
    const track = new FakeMediaStreamTrack('audio');
    const stream = new FakeMediaStream([track]);

    expect(stream.active).toBe(true);
    expect(stream.getTracks()).toHaveLength(1);
  });

  it('reports inactive when all tracks are ended', () => {
    const track = new FakeMediaStreamTrack('audio');
    const stream = new FakeMediaStream([track]);

    track.stop();
    expect(stream.active).toBe(false);
  });

  it('constructs empty when no tracks given', () => {
    const stream = new FakeMediaStream();
    expect(stream.getTracks()).toHaveLength(0);
    expect(stream.active).toBe(false);
  });

  it('filters tracks by kind', () => {
    const audio = new FakeMediaStreamTrack('audio');
    const video = new FakeMediaStreamTrack('video');
    const stream = new FakeMediaStream([audio, video]);

    expect(stream.getAudioTracks()).toEqual([audio]);
    expect(stream.getVideoTracks()).toEqual([video]);
  });

  it('addTrack and removeTrack modify the internal list', () => {
    const stream = new FakeMediaStream();
    const track = new FakeMediaStreamTrack('audio');

    stream.addTrack(track);
    expect(stream.getTracks()).toHaveLength(1);

    stream.removeTrack(track);
    expect(stream.getTracks()).toHaveLength(0);
  });

  it('addTrack ignores duplicates', () => {
    const track = new FakeMediaStreamTrack('audio');
    const stream = new FakeMediaStream([track]);

    stream.addTrack(track);
    expect(stream.getTracks()).toHaveLength(1);
  });

  it('generates a unique id', () => {
    const a = new FakeMediaStream();
    const b = new FakeMediaStream();
    expect(a.id).not.toBe(b.id);
  });
});

describe('FakeMediaRecorder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in inactive state', () => {
    const stream = new FakeMediaStream([new FakeMediaStreamTrack('audio')]);
    const recorder = new FakeMediaRecorder(stream);
    expect(recorder.state).toBe('inactive');
  });

  it('start() sets state to recording', () => {
    const stream = new FakeMediaStream([new FakeMediaStreamTrack('audio')]);
    const recorder = new FakeMediaRecorder(stream);
    recorder.start();
    expect(recorder.state).toBe('recording');
  });

  it('start(timeslice) fires ondataavailable at each interval', () => {
    const stream = new FakeMediaStream([new FakeMediaStreamTrack('audio')]);
    const recorder = new FakeMediaRecorder(stream);
    const events: FakeDataAvailableEvent[] = [];
    recorder.ondataavailable = (e) => events.push(e);

    recorder.start(1000);
    vi.advanceTimersByTime(3000);

    expect(events).toHaveLength(3);
    for (const event of events) {
      expect(event.type).toBe('dataavailable');
      expect(event.data).toBeInstanceOf(Blob);
    }
  });

  it('stop() fires final dataavailable then onstop', () => {
    const stream = new FakeMediaStream([new FakeMediaStreamTrack('audio')]);
    const recorder = new FakeMediaRecorder(stream);
    const order: string[] = [];

    recorder.ondataavailable = () => order.push('data');
    recorder.onstop = () => order.push('stop');

    recorder.start(1000);
    recorder.stop();

    expect(order).toEqual(['data', 'stop']);
    expect(recorder.state).toBe('inactive');
  });

  it('stop() clears the timeslice interval', () => {
    const stream = new FakeMediaStream([new FakeMediaStreamTrack('audio')]);
    const recorder = new FakeMediaRecorder(stream);
    const handler = vi.fn();
    recorder.ondataavailable = handler;

    recorder.start(1000);
    recorder.stop();
    handler.mockClear();

    vi.advanceTimersByTime(5000);
    expect(handler).not.toHaveBeenCalled();
  });

  it('addEventListener receives dataavailable and stop events', () => {
    const stream = new FakeMediaStream([new FakeMediaStreamTrack('audio')]);
    const recorder = new FakeMediaRecorder(stream);
    const dataHandler = vi.fn();
    const stopHandler = vi.fn();

    recorder.addEventListener('dataavailable', dataHandler);
    recorder.addEventListener('stop', stopHandler);

    recorder.start(1000);
    recorder.stop();

    expect(dataHandler).toHaveBeenCalledOnce();
    expect(stopHandler).toHaveBeenCalledOnce();
  });

  it('emitted Blob contains the configured chunkData', async () => {
    const customData = new Uint8Array([1, 2, 3]);
    FakeMediaRecorder.chunkData = customData;

    const stream = new FakeMediaStream([new FakeMediaStreamTrack('audio')]);
    const recorder = new FakeMediaRecorder(stream);
    let blob: Blob | undefined;
    recorder.ondataavailable = (e) => {
      blob = e.data;
    };

    recorder.start();
    recorder.stop();

    expect(blob).toBeDefined();
    const bytes = new Uint8Array(await blob!.arrayBuffer());
    expect(bytes).toEqual(customData);

    FakeMediaRecorder.chunkData = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
  });

  it('uses default mimeType when none specified', () => {
    const stream = new FakeMediaStream([new FakeMediaStreamTrack('audio')]);
    const recorder = new FakeMediaRecorder(stream);
    expect(recorder.mimeType).toBe('audio/webm;codecs=opus');
  });
});

describe('installFakeMediaDevices', () => {
  it('installs getUserMedia and getDisplayMedia on navigator.mediaDevices', async () => {
    const installed = installFakeMediaDevices();

    const micStream = await installed.getUserMedia({ audio: true });
    expect(micStream).toBeInstanceOf(FakeMediaStream);
    expect(micStream.getAudioTracks()).toHaveLength(1);

    const displayStream = await installed.getDisplayMedia({ video: true });
    expect(displayStream).toBeInstanceOf(FakeMediaStream);
    expect(displayStream.getVideoTracks()).toHaveLength(1);

    installed.restore();
  });

  it('restore() reinstates the original value', () => {
    const before = Object.getOwnPropertyDescriptor(globalThis.navigator, 'mediaDevices');
    const installed = installFakeMediaDevices();

    expect(installed.getUserMedia).toBeDefined();

    installed.restore();

    const after = Object.getOwnPropertyDescriptor(globalThis.navigator, 'mediaDevices');
    expect(after?.value).toEqual(before?.value);
  });

  it('getUserMedia and getDisplayMedia are vi.fn mocks', () => {
    const installed = installFakeMediaDevices();

    expect(vi.isMockFunction(installed.getUserMedia)).toBe(true);
    expect(vi.isMockFunction(installed.getDisplayMedia)).toBe(true);

    installed.restore();
  });
});
