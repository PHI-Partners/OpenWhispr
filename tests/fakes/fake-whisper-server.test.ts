import { type ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateTone, writeWavFile } from '../helpers/audio';
import { makeTempDir } from '../helpers/tempDir';
import { waitFor } from '../helpers/waitFor';

const SERVER_SCRIPT = join(import.meta.dirname, 'fake-whisper-server.mjs');

async function findFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

function startServer(args: string[]): ChildProcess {
  return spawn(process.execPath, [SERVER_SCRIPT, ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

function collectStderr(proc: ChildProcess): string[] {
  const lines: string[] = [];
  proc.stderr?.on('data', (chunk: Buffer) => {
    lines.push(...chunk.toString().split('\n').filter(Boolean));
  });
  return lines;
}

function waitForListening(proc: ChildProcess, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server start timeout')), timeoutMs);
    proc.stderr?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('server is listening')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    proc.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited early with code ${code}`));
    });
  });
}

async function postInference(port: number, wavPath: string): Promise<Response> {
  const wavData = readFileSync(wavPath);
  const form = new FormData();
  form.append('file', new Blob([wavData], { type: 'audio/wav' }), 'audio.wav');
  form.append('response_format', 'json');
  form.append('temperature', '0');
  return fetch(`http://127.0.0.1:${port}/inference`, { method: 'POST', body: form });
}

describe('fake-whisper-server', () => {
  let proc: ChildProcess | undefined;

  afterEach(() => {
    if (proc && !proc.killed) {
      proc.kill();
      proc = undefined;
    }
  });

  it('health returns 200 with { status: "ok" }', async () => {
    const port = await findFreePort();
    proc = startServer(['--host', '127.0.0.1', '--port', String(port), '--model', 'test.bin']);
    await waitForListening(proc);

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('inference returns scripted text for a valid 16 kHz mono WAV', async () => {
    const port = await findFreePort();
    const tmpDir = await makeTempDir();
    const wavPath = join(tmpDir, 'test.wav');
    writeWavFile(wavPath, generateTone(440, 500));

    proc = startServer([
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--model',
      'test.bin',
      '--text',
      'Hello world',
    ]);
    await waitForListening(proc);

    const res = await postInference(port, wavPath);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'Hello world' });
  });

  it('writes request log entries to --log-file', async () => {
    const port = await findFreePort();
    const tmpDir = await makeTempDir();
    const wavPath = join(tmpDir, 'test.wav');
    const logPath = join(tmpDir, 'requests.jsonl');
    writeWavFile(wavPath, generateTone(440, 100));

    proc = startServer([
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--model',
      'test.bin',
      '--log-file',
      logPath,
    ]);
    await waitForListening(proc);

    await postInference(port, wavPath);

    await waitFor(
      () => {
        try {
          return readFileSync(logPath, 'utf-8').trim().length > 0;
        } catch {
          return false;
        }
      },
      { timeout: 2000 },
    );

    const entries: unknown[] = readFileSync(logPath, 'utf-8')
      .trim()
      .split('\n')
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      .map((l) => JSON.parse(l));
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const last = entries[entries.length - 1];
    expect(last).toMatchObject({ method: 'POST', path: '/inference' });
    expect(last).toHaveProperty('timestamp');
  });

  it('prints startup log lines including the model path', async () => {
    const port = await findFreePort();
    proc = startServer(['--host', '127.0.0.1', '--port', String(port), '--model', '/path/to/model.bin']);
    const lines = collectStderr(proc);
    await waitForListening(proc);

    expect(lines.some((l) => l.includes('loading model'))).toBe(true);
    expect(lines.some((l) => l.includes('/path/to/model.bin'))).toBe(true);
  });

  it('slow-start delays health readiness', async () => {
    const port = await findFreePort();
    proc = startServer([
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--model',
      'test.bin',
      '--behavior',
      'slow-start:400',
    ]);

    // Server is listening on TCP but health returns 503
    await new Promise((r) => setTimeout(r, 150));
    const early = await fetch(`http://127.0.0.1:${port}/health`).catch(() => null);
    expect(early === null || early.status === 503).toBe(true);

    // After delay, health returns 200
    await waitForListening(proc, 3000);
    const late = await fetch(`http://127.0.0.1:${port}/health`);
    expect(late.status).toBe(200);
  });

  it('never-ready mode always returns 503 on health', async () => {
    const port = await findFreePort();
    proc = startServer([
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--model',
      'test.bin',
      '--behavior',
      'never-ready',
    ]);
    await waitForListening(proc);

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(503);
  });

  it('crash-after mode exits after N inference requests', async () => {
    const port = await findFreePort();
    const tmpDir = await makeTempDir();
    const wavPath = join(tmpDir, 'test.wav');
    writeWavFile(wavPath, generateTone(440, 100));

    proc = startServer([
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--model',
      'test.bin',
      '--behavior',
      'crash-after:2',
    ]);
    await waitForListening(proc);

    const res1 = await postInference(port, wavPath);
    expect(res1.status).toBe(200);
    const res2 = await postInference(port, wavPath);
    expect(res2.status).toBe(200);

    await waitFor(() => proc?.exitCode !== null, { timeout: 3000 });
    expect(proc?.exitCode).toBe(1);
  });

  it('error-500 mode returns HTTP 500 on inference', async () => {
    const port = await findFreePort();
    const tmpDir = await makeTempDir();
    const wavPath = join(tmpDir, 'test.wav');
    writeWavFile(wavPath, generateTone(440, 100));

    proc = startServer([
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--model',
      'test.bin',
      '--behavior',
      'error-500',
    ]);
    await waitForListening(proc);

    const res = await postInference(port, wavPath);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('hang mode accepts inference but never responds', async () => {
    const port = await findFreePort();
    const tmpDir = await makeTempDir();
    const wavPath = join(tmpDir, 'test.wav');
    writeWavFile(wavPath, generateTone(440, 100));

    proc = startServer([
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--model',
      'test.bin',
      '--behavior',
      'hang',
    ]);
    await waitForListening(proc);

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 500);

    const wavData = readFileSync(wavPath);
    const form = new FormData();
    form.append('file', new Blob([wavData], { type: 'audio/wav' }), 'audio.wav');

    await expect(
      fetch(`http://127.0.0.1:${port}/inference`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });

  it('gpu-init-failure mode logs GPU failure in startup', async () => {
    const port = await findFreePort();
    proc = startServer([
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--model',
      'test.bin',
      '--behavior',
      'gpu-init-failure',
    ]);
    const lines = collectStderr(proc);
    await waitForListening(proc);

    expect(lines.some((l) => l.includes('no GPU found'))).toBe(true);
  });

  it('--no-gpu flag logs CPU backend', async () => {
    const port = await findFreePort();
    proc = startServer(['--host', '127.0.0.1', '--port', String(port), '--model', 'test.bin', '--no-gpu']);
    const lines = collectStderr(proc);
    await waitForListening(proc);

    expect(lines.some((l) => l.includes('CPU'))).toBe(true);
  });
});
