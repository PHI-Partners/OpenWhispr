import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { pipeStreamToLogger, pipeChildProcess } from './childProcessAdapter';
import type { Logger } from './logger';

function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    close: vi.fn(),
  } satisfies Pick<Logger, 'debug' | 'info' | 'warn' | 'error' | 'close'>;
}

function flushStream(stream: PassThrough): Promise<void> {
  return new Promise((resolve) => {
    stream.end(() => resolve());
  });
}

describe('pipeStreamToLogger', () => {
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    logger = createMockLogger();
  });

  it('logs complete lines from stream', async () => {
    const stream = new PassThrough();
    pipeStreamToLogger(stream, logger as unknown as Logger, 'test', 'info');

    stream.write('line1\nline2\n');
    await flushStream(stream);

    expect(logger.info).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith('test', 'line1');
    expect(logger.info).toHaveBeenCalledWith('test', 'line2');
  });

  it('buffers partial lines until newline arrives', async () => {
    const stream = new PassThrough();
    pipeStreamToLogger(stream, logger as unknown as Logger, 'test', 'info');

    stream.write('par');
    expect(logger.info).not.toHaveBeenCalled();

    stream.write('tial\n');
    await flushStream(stream);

    expect(logger.info).toHaveBeenCalledWith('test', 'partial');
  });

  it('flushes remaining buffer on stream end', async () => {
    const stream = new PassThrough();
    pipeStreamToLogger(stream, logger as unknown as Logger, 'test', 'info');

    stream.write('no newline');
    await flushStream(stream);

    expect(logger.info).toHaveBeenCalledWith('test', 'no newline');
  });

  it('handles \\r\\n line endings', async () => {
    const stream = new PassThrough();
    pipeStreamToLogger(stream, logger as unknown as Logger, 'test', 'info');

    stream.write('line\r\n');
    await flushStream(stream);

    expect(logger.info).toHaveBeenCalledWith('test', 'line');
  });

  it('uses the specified log level', async () => {
    const stream = new PassThrough();
    pipeStreamToLogger(stream, logger as unknown as Logger, 'ffmpeg', 'warn');

    stream.write('warning message\n');
    await flushStream(stream);

    expect(logger.warn).toHaveBeenCalledWith('ffmpeg', 'warning message');
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('skips empty lines', async () => {
    const stream = new PassThrough();
    pipeStreamToLogger(stream, logger as unknown as Logger, 'test', 'info');

    stream.write('\n\n');
    await flushStream(stream);

    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe('pipeChildProcess', () => {
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    logger = createMockLogger();
  });

  it('pipes stdout as info and stderr as warn', async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = { stdout, stderr } as Parameters<typeof pipeChildProcess>[0];

    pipeChildProcess(child, { logger: logger as unknown as Logger, tag: 'srv' });

    stdout.write('out line\n');
    stderr.write('err line\n');
    await Promise.all([flushStream(stdout), flushStream(stderr)]);

    expect(logger.info).toHaveBeenCalledWith('srv', 'out line');
    expect(logger.warn).toHaveBeenCalledWith('srv', 'err line');
  });

  it('uses custom level for stdout when specified', async () => {
    const stdout = new PassThrough();
    const child = { stdout, stderr: null } as unknown as Parameters<typeof pipeChildProcess>[0];

    pipeChildProcess(child, { logger: logger as unknown as Logger, tag: 'srv', level: 'debug' });

    stdout.write('debug line\n');
    await flushStream(stdout);

    expect(logger.debug).toHaveBeenCalledWith('srv', 'debug line');
  });

  it('handles null stdout and stderr without throwing', () => {
    const child = { stdout: null, stderr: null } as unknown as Parameters<typeof pipeChildProcess>[0];
    expect(() => {
      pipeChildProcess(child, { logger: logger as unknown as Logger, tag: 'srv' });
    }).not.toThrow();
  });
});
