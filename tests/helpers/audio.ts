import { readFileSync, writeFileSync } from 'node:fs';

export interface WavHeader {
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataSize: number;
  durationSeconds: number;
}

export function generateTone(hz: number, durationMs: number, sampleRate = 16000): Int16Array {
  const numSamples = Math.floor((durationMs / 1000) * sampleRate);
  const pcm = new Int16Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    pcm[i] = Math.round(32767 * 0.8 * Math.sin((2 * Math.PI * hz * i) / sampleRate));
  }
  return pcm;
}

export function generateSilence(durationMs: number, sampleRate = 16000): Int16Array {
  return new Int16Array(Math.floor((durationMs / 1000) * sampleRate));
}

export function rms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < pcm.length; i++) {
    const sample = pcm[i];
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / pcm.length);
}

export function writeWavFile(filePath: string, pcm: Int16Array, sampleRate = 16000, channels = 1): void {
  const bitsPerSample = 16;
  const dataSize = pcm.length * 2;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  writeFileSync(filePath, Buffer.concat([header, data]));
}

export function parseWavHeader(filePath: string): WavHeader {
  const buf = readFileSync(filePath);
  if (buf.length < 44) throw new Error('File too short for WAV header');
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Missing RIFF marker');
  if (buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Missing WAVE marker');

  const channels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);
  const dataSize = buf.readUInt32LE(40);
  const durationSeconds = dataSize / (sampleRate * channels * (bitsPerSample / 8));

  return { channels, sampleRate, bitsPerSample, dataSize, durationSeconds };
}
