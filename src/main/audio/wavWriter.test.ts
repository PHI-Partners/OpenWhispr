import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { makeTempDir } from '../../../tests/helpers/tempDir';
import { generateTone, parseWavHeader } from '../../../tests/helpers/audio';
import { WavWriter, repairWavHeader } from './wavWriter';

let tempDir: string;

beforeEach(async () => {
  tempDir = await makeTempDir();
});

describe('WavWriter', () => {
  it('writes a valid WAV header on close', () => {
    const filePath = join(tempDir, 'out.wav');
    const writer = new WavWriter({ filePath });

    const tone = generateTone(440, 1000);
    const pcm = Buffer.from(tone.buffer, tone.byteOffset, tone.byteLength);
    writer.write(pcm);
    writer.close();

    const header = parseWavHeader(filePath);
    expect(header.sampleRate).toBe(16_000);
    expect(header.channels).toBe(1);
    expect(header.bitsPerSample).toBe(16);
    expect(header.dataSize).toBe(pcm.length);
    expect(header.durationSeconds).toBeCloseTo(1.0, 1);
  });

  it('accumulates multiple writes into the correct data size', () => {
    const filePath = join(tempDir, 'multi.wav');
    const writer = new WavWriter({ filePath });

    const chunkDurationMs = 1000;
    const numChunks = 100;
    let totalBytes = 0;

    for (let i = 0; i < numChunks; i++) {
      const tone = generateTone(440, chunkDurationMs);
      const pcm = Buffer.from(tone.buffer, tone.byteOffset, tone.byteLength);
      writer.write(pcm);
      totalBytes += pcm.length;
    }
    writer.close();

    const header = parseWavHeader(filePath);
    expect(header.dataSize).toBe(totalBytes);
    expect(header.durationSeconds).toBeCloseTo(100, 0);
  });

  it('tracks durationSeconds as writes accumulate', () => {
    const filePath = join(tempDir, 'duration.wav');
    const writer = new WavWriter({ filePath });

    expect(writer.durationSeconds).toBe(0);

    const tone1s = generateTone(440, 1000);
    writer.write(Buffer.from(tone1s.buffer, tone1s.byteOffset, tone1s.byteLength));
    expect(writer.durationSeconds).toBeCloseTo(1.0, 1);

    writer.write(Buffer.from(tone1s.buffer, tone1s.byteOffset, tone1s.byteLength));
    expect(writer.durationSeconds).toBeCloseTo(2.0, 1);

    writer.close();
  });

  it('tracks bytesWritten', () => {
    const filePath = join(tempDir, 'bytes.wav');
    const writer = new WavWriter({ filePath });

    expect(writer.bytesWritten).toBe(0);

    const tone = generateTone(440, 500);
    const pcm = Buffer.from(tone.buffer, tone.byteOffset, tone.byteLength);
    writer.write(pcm);
    expect(writer.bytesWritten).toBe(pcm.length);

    writer.close();
  });

  it('close is idempotent', () => {
    const filePath = join(tempDir, 'idempotent.wav');
    const writer = new WavWriter({ filePath });

    const tone = generateTone(440, 100);
    writer.write(Buffer.from(tone.buffer, tone.byteOffset, tone.byteLength));
    writer.close();
    expect(() => writer.close()).not.toThrow();

    const header = parseWavHeader(filePath);
    expect(header.sampleRate).toBe(16_000);
  });

  it('throws on write after close', () => {
    const filePath = join(tempDir, 'closed.wav');
    const writer = new WavWriter({ filePath });
    writer.close();

    expect(() => writer.write(Buffer.alloc(100))).toThrow('WavWriter is closed');
  });

  it('respects custom sample rate and channels', () => {
    const filePath = join(tempDir, 'custom.wav');
    const writer = new WavWriter({ filePath, sampleRate: 44_100, channels: 2 });

    const pcm = Buffer.alloc(44_100 * 2 * 2);
    writer.write(pcm);
    writer.close();

    const header = parseWavHeader(filePath);
    expect(header.sampleRate).toBe(44_100);
    expect(header.channels).toBe(2);
    expect(header.durationSeconds).toBeCloseTo(1.0, 1);
  });
});

describe('repairWavHeader', () => {
  it('patches a truncated WAV file with correct header sizes', () => {
    const filePath = join(tempDir, 'truncated.wav');

    const placeholderHeader = Buffer.alloc(44);
    const tone = generateTone(440, 2000);
    const pcm = Buffer.from(tone.buffer, tone.byteOffset, tone.byteLength);
    writeFileSync(filePath, Buffer.concat([placeholderHeader, pcm]));

    repairWavHeader(filePath);

    const header = parseWavHeader(filePath);
    expect(header.sampleRate).toBe(16_000);
    expect(header.channels).toBe(1);
    expect(header.bitsPerSample).toBe(16);
    expect(header.dataSize).toBe(pcm.length);
    expect(header.durationSeconds).toBeCloseTo(2.0, 1);
  });

  it('repairs with custom audio parameters', () => {
    const filePath = join(tempDir, 'custom-repair.wav');

    const pcmBytes = 44_100 * 2 * 2;
    writeFileSync(filePath, Buffer.concat([Buffer.alloc(44), Buffer.alloc(pcmBytes)]));

    repairWavHeader(filePath, { sampleRate: 44_100, channels: 2 });

    const header = parseWavHeader(filePath);
    expect(header.sampleRate).toBe(44_100);
    expect(header.channels).toBe(2);
    expect(header.dataSize).toBe(pcmBytes);
  });

  it('throws when file is shorter than the WAV header', () => {
    const filePath = join(tempDir, 'tiny.wav');
    writeFileSync(filePath, Buffer.alloc(20));

    expect(() => repairWavHeader(filePath)).toThrow(/too short/i);
  });
});
