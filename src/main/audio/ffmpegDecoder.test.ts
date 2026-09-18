import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import type { Logger } from '../logger';
import { FfmpegDecoder, FfmpegDecoderError } from './ffmpegDecoder';

const FIXTURES = join(__dirname, '..', '..', '..', 'tests', 'fixtures');

/** Find the 'data' chunk in a WAV file and return its declared size. */
function wavDataSize(filePath: string): number {
  const buf = readFileSync(filePath);
  for (let i = 12; i < buf.length - 8; i++) {
    if (buf.toString('ascii', i, i + 4) === 'data') {
      return buf.readUInt32LE(i + 4);
    }
  }
  throw new Error('No data chunk found in WAV file');
}

function mockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    close: vi.fn(),
  } as unknown as Logger;
}

function sliceBuffer(buf: Buffer, chunkSize: number): Buffer[] {
  const chunks: Buffer[] = [];
  for (let i = 0; i < buf.length; i += chunkSize) {
    chunks.push(buf.subarray(i, Math.min(i + chunkSize, buf.length)));
  }
  return chunks;
}

describe('FfmpegDecoder', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = mockLogger();
  });

  it('decodes jfk.webm streamed in 1s slices to ~correct PCM byte count', async () => {
    const webm = readFileSync(join(FIXTURES, 'jfk.webm'));
    const expectedBytes = wavDataSize(join(FIXTURES, 'jfk.wav'));

    const decoder = new FfmpegDecoder({ ffmpegPath: ffmpegPath!, logger });
    decoder.start();

    const pcmChunks: Buffer[] = [];
    decoder.on('data', (chunk) => pcmChunks.push(chunk));

    const chunks = sliceBuffer(webm, 48_000);
    for (const chunk of chunks) {
      decoder.write(chunk);
    }

    await decoder.end();

    const totalBytes = pcmChunks.reduce((sum, c) => sum + c.length, 0);
    const tolerance = expectedBytes * 0.1;
    expect(totalBytes).toBeGreaterThan(expectedBytes - tolerance);
    expect(totalBytes).toBeLessThan(expectedBytes + tolerance);
  }, 15_000);

  it('flushes all PCM data on graceful end', async () => {
    const webm = readFileSync(join(FIXTURES, 'jfk.webm'));

    const decoder = new FfmpegDecoder({ ffmpegPath: ffmpegPath!, logger });
    decoder.start();

    const pcmChunks: Buffer[] = [];
    decoder.on('data', (chunk) => pcmChunks.push(chunk));

    // Write only the first half
    const half = webm.subarray(0, Math.floor(webm.length / 2));
    decoder.write(half);

    await decoder.end();

    const totalBytes = pcmChunks.reduce((sum, c) => sum + c.length, 0);
    expect(totalBytes).toBeGreaterThan(0);
    // All emitted chunks should be even-aligned (2 bytes per sample)
    for (const chunk of pcmChunks) {
      expect(chunk.length % 2).toBe(0);
    }
  }, 15_000);

  it('emits PCM chunks that are always even-aligned', async () => {
    const webm = readFileSync(join(FIXTURES, 'jfk.webm'));

    const decoder = new FfmpegDecoder({ ffmpegPath: ffmpegPath!, logger });
    decoder.start();

    const pcmChunks: Buffer[] = [];
    decoder.on('data', (chunk) => pcmChunks.push(chunk));

    decoder.write(webm);
    await decoder.end();

    expect(pcmChunks.length).toBeGreaterThan(0);
    for (const chunk of pcmChunks) {
      expect(chunk.length % 2).toBe(0);
    }
  }, 15_000);

  it('rejects with NON_ZERO_EXIT when ffmpeg gets invalid input', async () => {
    const decoder = new FfmpegDecoder({ ffmpegPath: ffmpegPath!, logger });
    decoder.start();

    decoder.write(Buffer.from('this is not valid matroska data'));

    try {
      await decoder.end();
      expect.fail('expected end() to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(FfmpegDecoderError);
      expect((err as FfmpegDecoderError).code).toBe('NON_ZERO_EXIT');
    }
  }, 15_000);

  it('throws WRITE_AFTER_END when writing after end()', async () => {
    const webm = readFileSync(join(FIXTURES, 'jfk.webm'));
    const decoder = new FfmpegDecoder({ ffmpegPath: ffmpegPath!, logger });
    decoder.start();

    decoder.write(webm);
    const endPromise = decoder.end();

    expect(() => decoder.write(Buffer.from('data'))).toThrow(FfmpegDecoderError);
    expect(() => decoder.write(Buffer.from('data'))).toThrow(/after end/i);

    await endPromise;
  }, 15_000);

  it('emits SPAWN_FAILURE for a nonexistent binary', async () => {
    const decoder = new FfmpegDecoder({
      ffmpegPath: '/nonexistent/ffmpeg',
      logger,
    });

    const errors: FfmpegDecoderError[] = [];
    decoder.on('error', (err) => errors.push(err));

    decoder.start();

    // Give the spawn error time to propagate
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].code).toBe('SPAWN_FAILURE');
  });
});
