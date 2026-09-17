import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTempDir } from './tempDir';
import { generateSilence, generateTone, parseWavHeader, rms, writeWavFile } from './audio';

describe('generateTone', () => {
  it('produces the expected number of samples', () => {
    const pcm = generateTone(440, 1000, 16000);
    expect(pcm.length).toBe(16000);
  });

  it('produces non-silent output', () => {
    const pcm = generateTone(440, 100, 16000);
    expect(rms(pcm)).toBeGreaterThan(0);
  });

  it('uses 16 kHz default sample rate', () => {
    const pcm = generateTone(440, 500);
    expect(pcm.length).toBe(8000);
  });
});

describe('generateSilence', () => {
  it('produces the expected number of samples', () => {
    const pcm = generateSilence(1000, 16000);
    expect(pcm.length).toBe(16000);
  });

  it('is all zeros', () => {
    const pcm = generateSilence(100, 16000);
    expect(rms(pcm)).toBe(0);
  });
});

describe('rms', () => {
  it('returns 0 for silence', () => {
    expect(rms(new Int16Array(100))).toBe(0);
  });

  it('returns 0 for empty array', () => {
    expect(rms(new Int16Array(0))).toBe(0);
  });

  it('returns correct value for a known signal', () => {
    const pcm = new Int16Array([100, -100, 100, -100]);
    expect(rms(pcm)).toBe(100);
  });
});

describe('writeWavFile + parseWavHeader', () => {
  it('round-trips a WAV with correct header fields', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'test.wav');
    const pcm = generateTone(440, 500, 16000);

    writeWavFile(filePath, pcm);
    const header = parseWavHeader(filePath);

    expect(header.channels).toBe(1);
    expect(header.sampleRate).toBe(16000);
    expect(header.bitsPerSample).toBe(16);
    expect(header.dataSize).toBe(pcm.length * 2);
    expect(header.durationSeconds).toBeCloseTo(0.5, 2);
  });

  it('writes data that matches the source PCM', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'test.wav');
    const pcm = generateTone(440, 100, 16000);

    writeWavFile(filePath, pcm);
    const raw = readFileSync(filePath);
    const dataPcm = new Int16Array(raw.buffer, raw.byteOffset + 44, pcm.length);

    expect(dataPcm).toEqual(pcm);
  });

  it('writes a 2-channel WAV when requested', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'stereo.wav');
    const pcm = new Int16Array(3200);

    writeWavFile(filePath, pcm, 16000, 2);
    const header = parseWavHeader(filePath);

    expect(header.channels).toBe(2);
    expect(header.durationSeconds).toBeCloseTo(0.1, 2);
  });
});
