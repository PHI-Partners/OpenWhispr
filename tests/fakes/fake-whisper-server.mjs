#!/usr/bin/env node

/**
 * Fake whisper-server for testing. CLI-compatible with the real binary.
 *
 * Extra flags beyond the real binary:
 *   --behavior <mode>   Failure simulation (default: normal)
 *   --text <string>     Scripted inference response text
 *   --log-file <path>   JSONL request log for test assertions
 *
 * Behavior modes:
 *   normal            Health 200, inference returns scripted text
 *   slow-start:<ms>   HTTP server listens immediately; health returns 503
 *                     until <ms> elapsed, then logs readiness
 *   never-ready       Health always returns 503
 *   crash-after:<n>   Process exits after <n> inference requests
 *   error-500         Inference always returns HTTP 500
 *   hang              Inference accepts the request but never responds
 *   gpu-init-failure  Startup logs report GPU init failure, then proceeds as CPU
 */

import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';

// ── CLI arg parsing ──

const argv = process.argv.slice(2);

/** @param {string} name */
function getArg(name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

/** @param {string} name */
function hasFlag(name) {
  return argv.includes(name);
}

const model = getArg('--model') ?? 'unknown';
const host = getArg('--host') ?? '127.0.0.1';
const port = parseInt(getArg('--port') ?? '8178', 10);
const noGpu = hasFlag('--no-gpu');
const behavior = getArg('--behavior') ?? 'normal';
const scriptedText = getArg('--text') ?? 'This is a test transcription.';
const logFile = getArg('--log-file');
// --language is accepted and ignored (real server uses it)

// ── Behavior parsing ──

const colonIdx = behavior.indexOf(':');
const behaviorMode = colonIdx >= 0 ? behavior.slice(0, colonIdx) : behavior;
const behaviorParam = colonIdx >= 0 ? parseInt(behavior.slice(colonIdx + 1), 10) : 0;

// ── Helpers ──

/** @param {string} msg */
function log(msg) {
  process.stderr.write(msg + '\n');
}

/** @param {Record<string, unknown>} entry */
function logRequest(entry) {
  if (!logFile) return;
  appendFileSync(logFile, JSON.stringify({ ...entry, timestamp: Date.now() }) + '\n');
}

// ── Startup log lines (match real whisper-server patterns) ──

log(`whisper_init_from_file_with_params_no_state: loading model from '${model}'`);
log('system_info: n_threads = 4 / 8 | AVX2 = 1 | NEON = 0');

if (behaviorMode === 'gpu-init-failure') {
  log('ggml_vulkan: no Vulkan device found');
  log('whisper_backend_init_gpu: no GPU found, falling back to CPU');
} else if (noGpu) {
  log('whisper_backend_init: using CPU backend');
} else {
  log('whisper_backend_init_gpu: using Vulkan on Test GPU');
}

// ── Multipart form-data parser ──

/**
 * @param {Buffer} body
 * @param {string} contentType
 * @returns {Array<{name: string | undefined, filename: string | undefined, data: Buffer}>}
 */
function parseMultipart(body, contentType) {
  const match = contentType.match(/boundary=([^\s;]+)/);
  if (!match) return [];

  const boundary = match[1];
  const delimiter = Buffer.from(`--${boundary}`);
  /** @type {Array<{name: string | undefined, filename: string | undefined, data: Buffer}>} */
  const parts = [];
  let pos = body.indexOf(delimiter);

  while (pos !== -1) {
    pos += delimiter.length;
    if (body.length > pos + 1 && body[pos] === 0x2d && body[pos + 1] === 0x2d) break;
    if (body.length > pos + 1 && body[pos] === 0x0d && body[pos + 1] === 0x0a) pos += 2;

    const headerEnd = body.indexOf('\r\n\r\n', pos);
    if (headerEnd === -1) break;

    const headers = body.subarray(pos, headerEnd).toString('utf-8');
    const bodyStart = headerEnd + 4;
    const nextDelim = body.indexOf(delimiter, bodyStart);
    if (nextDelim === -1) break;

    const partBody = body.subarray(bodyStart, nextDelim - 2);
    const nameMatch = headers.match(/name="([^"]+)"/);
    const filenameMatch = headers.match(/filename="([^"]+)"/);
    parts.push({ name: nameMatch?.[1], filename: filenameMatch?.[1], data: partBody });
    pos = nextDelim;
  }

  return parts;
}

/**
 * @param {Buffer} data
 * @returns {{valid: boolean, reason?: string, channels?: number, sampleRate?: number, bitsPerSample?: number}}
 */
function validateWav(data) {
  if (data.length < 44) return { valid: false, reason: 'Too short for WAV header' };
  if (data.toString('ascii', 0, 4) !== 'RIFF') return { valid: false, reason: 'Missing RIFF' };
  if (data.toString('ascii', 8, 12) !== 'WAVE') return { valid: false, reason: 'Missing WAVE' };
  const channels = data.readUInt16LE(22);
  const sampleRate = data.readUInt32LE(24);
  const bitsPerSample = data.readUInt16LE(34);
  if (channels !== 1) return { valid: false, reason: `Expected mono, got ${channels} ch` };
  if (sampleRate !== 16000) return { valid: false, reason: `Expected 16000 Hz, got ${sampleRate}` };
  if (bitsPerSample !== 16) return { valid: false, reason: `Expected 16-bit, got ${bitsPerSample}` };
  return { valid: true, channels, sampleRate, bitsPerSample };
}

// ── State ──

/** @type {boolean} */
let ready;
let inferenceCount = 0;

switch (behaviorMode) {
  case 'slow-start':
    ready = false;
    break;
  case 'never-ready':
    ready = false;
    break;
  default:
    ready = true;
    break;
}

if (behaviorMode === 'slow-start') {
  setTimeout(() => {
    ready = true;
    log(`main: server is listening on ${host}:${port}`);
  }, behaviorParam || 1000);
}

// ── HTTP server ──

const server = createServer((req, res) => {
  // GET /health
  if (req.method === 'GET' && req.url === '/health') {
    logRequest({ method: 'GET', path: '/health' });
    if (ready) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'loading model' }));
    }
    return;
  }

  // POST /inference
  if (req.method === 'POST' && req.url === '/inference') {
    /** @type {Buffer[]} */
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      inferenceCount++;
      logRequest({ method: 'POST', path: '/inference', bodySize: body.length, inferenceCount });

      if (behaviorMode === 'error-500') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error (simulated)' }));
        return;
      }

      if (behaviorMode === 'hang') {
        return; // never respond
      }

      if (behaviorMode === 'crash-after' && inferenceCount >= behaviorParam) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text: scriptedText }));
        setTimeout(() => process.exit(1), 50);
        return;
      }

      const contentType = req.headers['content-type'] ?? '';
      const parts = parseMultipart(body, contentType);
      const filePart = parts.find((p) => p.name === 'file');

      if (!filePart) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing file field' }));
        return;
      }

      const wav = validateWav(filePart.data);
      if (!wav.valid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Invalid WAV: ${wav.reason}` }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text: scriptedText }));
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(port, host, () => {
  if (behaviorMode !== 'slow-start') {
    log(`main: server is listening on ${host}:${port}`);
  }
});

// Exit cleanly when stdin closes (parent process signals shutdown)
process.stdin.resume();
process.stdin.on('end', () => {
  server.close();
  process.exit(0);
});
