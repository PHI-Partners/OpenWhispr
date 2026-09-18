import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeTempDir } from '../../../tests/helpers/tempDir';
import { parseWavHeader } from '../../../tests/helpers/audio';
import type { Logger } from '../logger';
import type { FfmpegDecoderEvents, FfmpegDecoderOpts } from './ffmpegDecoder';
import {
  RecordingSession,
  RecordingSessionError,
  type CompletedResult,
} from './recordingSession';

class FakeDecoder extends EventEmitter<FfmpegDecoderEvents> {
  start = vi.fn();
  write = vi.fn();
  end = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
}

let fakeDecoder: FakeDecoder;

vi.mock('./ffmpegDecoder', () => ({
  FfmpegDecoder: class {
    constructor(_opts: FfmpegDecoderOpts) {
      fakeDecoder = new FakeDecoder();
      return fakeDecoder;
    }
  },
}));

function mockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    close: vi.fn(),
  } as unknown as Logger;
}

describe('RecordingSession', () => {
  let tempDir: string;
  let session: RecordingSession;
  let audioPath: string;

  beforeEach(async () => {
    tempDir = await makeTempDir('recording-session-');
    audioPath = join(tempDir, 'test.wav');
    session = new RecordingSession({
      sessionId: 'test-session-1',
      audioPath,
      ffmpegPath: '/fake/ffmpeg',
      logger: mockLogger(),
    });
  });

  it('emits started on start()', () => {
    const started = vi.fn();
    session.on('started', started);
    session.start();
    expect(started).toHaveBeenCalledOnce();
    expect(fakeDecoder.start).toHaveBeenCalledOnce();
  });

  it('forwards decoder PCM as pcm events', () => {
    session.start();
    const pcmChunks: Buffer[] = [];
    session.on('pcm', (pcm) => pcmChunks.push(pcm));

    const pcm = Buffer.alloc(3200, 0x42);
    fakeDecoder.emit('data', pcm);

    expect(pcmChunks).toHaveLength(1);
    expect(pcmChunks[0]).toBe(pcm);
  });

  it('writes decoder PCM to the WAV file', async () => {
    session.start();

    const pcm = Buffer.alloc(32000);
    for (let i = 0; i < pcm.length / 2; i++) {
      pcm.writeInt16LE(Math.round(Math.sin(i * 0.1) * 16000), i * 2);
    }
    fakeDecoder.emit('data', pcm);

    await session.finalize();
    const header = parseWavHeader(audioPath);
    expect(header.sampleRate).toBe(16000);
    expect(header.channels).toBe(1);
    expect(header.bitsPerSample).toBe(16);
    expect(header.dataSize).toBe(pcm.length);
  });

  it('accepts sequential chunks (0, 1, 2)', () => {
    session.start();
    session.writeChunk(0, Buffer.from([1, 2]));
    session.writeChunk(1, Buffer.from([3, 4]));
    session.writeChunk(2, Buffer.from([5, 6]));
    expect(fakeDecoder.write).toHaveBeenCalledTimes(3);
  });

  it('rejects out-of-order chunk', () => {
    session.start();
    expect(() => session.writeChunk(2, Buffer.from([1, 2]))).toThrow(RecordingSessionError);
    expect(() => session.writeChunk(2, Buffer.from([1, 2]))).toThrow('Expected chunk seq 0, got 2');
  });

  it('rejects duplicate sequence number', () => {
    session.start();
    session.writeChunk(0, Buffer.from([1, 2]));
    expect(() => session.writeChunk(0, Buffer.from([3, 4]))).toThrow(RecordingSessionError);
    expect(() => session.writeChunk(0, Buffer.from([3, 4]))).toThrow('Expected chunk seq 1, got 0');
  });

  it('emits completed with audioPath and durationSeconds after finalize', async () => {
    session.start();
    const pcm = Buffer.alloc(32000);
    fakeDecoder.emit('data', pcm);

    const completed = vi.fn();
    session.on('completed', completed);
    await session.finalize();

    expect(completed).toHaveBeenCalledOnce();
    const result = completed.mock.calls[0][0] as CompletedResult;
    expect(result.audioPath).toBe(audioPath);
    expect(result.durationSeconds).toBe(1);
  });

  it('decoder error emits failed and still closes WAV writer', () => {
    session.start();
    const pcm = Buffer.alloc(3200);
    fakeDecoder.emit('data', pcm);

    const failed = vi.fn();
    session.on('failed', failed);

    const err = new Error('decoder crashed');
    fakeDecoder.emit('error', err as never);

    expect(failed).toHaveBeenCalledOnce();
    expect((failed.mock.calls[0][0] as Error).message).toBe('decoder crashed');

    const header = parseWavHeader(audioPath);
    expect(header.dataSize).toBe(3200);
  });

  it('finalize with decoder rejection emits failed and closes WAV', async () => {
    session.start();
    const pcm = Buffer.alloc(3200);
    fakeDecoder.emit('data', pcm);

    fakeDecoder.end.mockRejectedValueOnce(new Error('ffmpeg exited with code 1'));

    const failed = vi.fn();
    session.on('failed', failed);
    await session.finalize();

    expect(failed).toHaveBeenCalledOnce();
    expect((failed.mock.calls[0][0] as Error).message).toBe('ffmpeg exited with code 1');

    const header = parseWavHeader(audioPath);
    expect(header.dataSize).toBe(3200);
  });

  it('writeChunk throws after session has failed', () => {
    session.start();
    fakeDecoder.emit('error', new Error('crashed') as never);

    expect(() => session.writeChunk(0, Buffer.from([1, 2]))).toThrow(RecordingSessionError);
    expect(() => session.writeChunk(0, Buffer.from([1, 2]))).toThrow('Session has failed');
  });

  it('does not double-emit failed when decoder error races with finalize rejection', async () => {
    session.start();

    fakeDecoder.end.mockImplementation(() => {
      fakeDecoder.emit('error', new Error('error event') as never);
      return Promise.reject(new Error('close rejection'));
    });

    const failed = vi.fn();
    session.on('failed', failed);
    await session.finalize();

    expect(failed).toHaveBeenCalledOnce();
  });
});
