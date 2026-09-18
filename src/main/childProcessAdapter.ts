import type { ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';
import type { Logger, LogLevelName } from './logger';

export function pipeStreamToLogger(stream: Readable, logger: Logger, tag: string, level: LogLevelName): void {
  let buffer = '';
  const log = logger[level].bind(logger);

  stream.on('data', (chunk: Buffer | string) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    const lines = buffer.split('\n');
    buffer = lines.pop()!;
    for (const line of lines) {
      const trimmed = line.replace(/\r$/, '');
      if (trimmed.length > 0) log(tag, trimmed);
    }
  });

  const flush = (): void => {
    const trimmed = buffer.replace(/\r$/, '');
    if (trimmed.length > 0) log(tag, trimmed);
    buffer = '';
  };

  stream.on('end', flush);
  stream.on('close', flush);
}

export interface PipeChildProcessOpts {
  logger: Logger;
  tag: string;
  level?: LogLevelName;
}

export function pipeChildProcess(
  child: Pick<ChildProcess, 'stdout' | 'stderr'>,
  opts: PipeChildProcessOpts,
): void {
  if (child.stdout) pipeStreamToLogger(child.stdout, opts.logger, opts.tag, opts.level ?? 'info');
  if (child.stderr) pipeStreamToLogger(child.stderr, opts.logger, opts.tag, 'warn');
}
