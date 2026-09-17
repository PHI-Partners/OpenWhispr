#!/usr/bin/env node

/**
 * Provisioning script: downloads and generates test audio fixtures.
 * Run: node scripts/fetch-test-fixtures.mjs
 * Idempotent: skips files that already exist with correct content.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FIXTURES_DIR = join(ROOT, 'tests', 'fixtures');

const JFK_URL =
  'https://github.com/ggerganov/whisper.cpp/raw/v1.7.4/samples/jfk.wav';
// Pinned after first successful download — verified against the v1.7.4 tag.
const JFK_SHA256 = '59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e';

const SAMPLE_RATE = 16000;

/** @param {string} filePath */
function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/**
 * @param {string} filePath
 * @param {Int16Array} pcm
 * @param {number} [sampleRate]
 * @param {number} [channels]
 */
function writeWav(filePath, pcm, sampleRate = SAMPLE_RATE, channels = 1) {
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

  writeFileSync(
    filePath,
    Buffer.concat([header, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)]),
  );
}

async function main() {
  await mkdir(FIXTURES_DIR, { recursive: true });
  console.log('Provisioning test fixtures into tests/fixtures/\n');

  // 1. jfk.wav — download from whisper.cpp samples
  const jfkWav = join(FIXTURES_DIR, 'jfk.wav');
  if (existsSync(jfkWav) && (!JFK_SHA256 || sha256(jfkWav) === JFK_SHA256)) {
    console.log('  jfk.wav: up to date');
  } else {
    console.log(`  Downloading ${JFK_URL}`);
    const res = await fetch(JFK_URL, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} downloading jfk.wav`);
    writeFileSync(jfkWav, Buffer.from(await res.arrayBuffer()));
    const hash = sha256(jfkWav);
    if (JFK_SHA256 && hash !== JFK_SHA256) {
      throw new Error(`jfk.wav SHA-256 mismatch: expected ${JFK_SHA256}, got ${hash}`);
    }
    console.log(`  jfk.wav: downloaded (SHA-256: ${hash})`);
    if (!JFK_SHA256) {
      console.log('  >>> Pin this hash as JFK_SHA256 in scripts/fetch-test-fixtures.mjs');
    }
  }

  // 2. jfk.webm — convert jfk.wav to WebM/Opus via ffmpeg-static
  const jfkWebm = join(FIXTURES_DIR, 'jfk.webm');
  if (existsSync(jfkWebm)) {
    console.log('  jfk.webm: up to date');
  } else {
    const { default: ffmpegPath } = await import('ffmpeg-static');
    if (!ffmpegPath) throw new Error('ffmpeg-static binary not available for this platform');
    execFileSync(ffmpegPath, ['-y', '-i', jfkWav, '-c:a', 'libopus', '-b:a', '48k', jfkWebm], {
      stdio: 'pipe',
    });
    console.log('  jfk.webm: generated from jfk.wav');
  }

  // 3. tone.wav — 440 Hz sine, 1 second, 16 kHz mono 16-bit
  const toneWav = join(FIXTURES_DIR, 'tone.wav');
  if (existsSync(toneWav)) {
    console.log('  tone.wav: up to date');
  } else {
    const samples = SAMPLE_RATE;
    const pcm = new Int16Array(samples);
    for (let i = 0; i < samples; i++) {
      pcm[i] = Math.round(32767 * 0.8 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE));
    }
    writeWav(toneWav, pcm);
    console.log('  tone.wav: generated (440 Hz, 1 s)');
  }

  // 4. silence.wav — 1 second of silence, 16 kHz mono 16-bit
  const silenceWav = join(FIXTURES_DIR, 'silence.wav');
  if (existsSync(silenceWav)) {
    console.log('  silence.wav: up to date');
  } else {
    writeWav(silenceWav, new Int16Array(SAMPLE_RATE));
    console.log('  silence.wav: generated (1 s silence)');
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
