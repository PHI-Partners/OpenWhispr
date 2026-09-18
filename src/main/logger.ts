import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';

const LogLevel = { debug: 0, info: 1, warn: 2, error: 3 } as const;
export type LogLevelName = keyof typeof LogLevel;

const LEVEL_LABELS: Record<LogLevelName, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
};

export interface LoggerOpts {
  logsDir: string;
  level?: LogLevelName;
  maxFileSize?: number;
  maxFiles?: number;
  console?: Pick<Console, 'log' | 'warn' | 'error'>;
}

const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5;

export class Logger {
  private readonly logsDir: string;
  private readonly threshold: number;
  private readonly maxFileSize: number;
  private readonly maxFiles: number;
  private readonly cons: Pick<Console, 'log' | 'warn' | 'error'>;
  private readonly logPath: string;
  private fd: number | null;

  constructor(opts: LoggerOpts) {
    this.logsDir = opts.logsDir;
    this.threshold = LogLevel[opts.level ?? 'info'];
    this.maxFileSize = opts.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
    this.maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
    this.cons = opts.console ?? globalThis.console;
    this.logPath = join(this.logsDir, 'app.log');

    mkdirSync(this.logsDir, { recursive: true });
    this.fd = openSync(this.logPath, 'a');
  }

  debug(tag: string, message: string, ...args: unknown[]): void {
    this.write('debug', tag, message, args);
  }

  info(tag: string, message: string, ...args: unknown[]): void {
    this.write('info', tag, message, args);
  }

  warn(tag: string, message: string, ...args: unknown[]): void {
    this.write('warn', tag, message, args);
  }

  error(tag: string, message: string, ...args: unknown[]): void {
    this.write('error', tag, message, args);
  }

  close(): void {
    if (this.fd !== null) {
      closeSync(this.fd);
      this.fd = null;
    }
  }

  private write(level: LogLevelName, tag: string, message: string, args: unknown[]): void {
    if (this.fd === null) return;
    if (LogLevel[level] < this.threshold) return;

    const extra = args.length > 0 ? ' ' + args.map(formatArg).join(' ') : '';
    const line = `[${new Date().toISOString()}] [${LEVEL_LABELS[level]}] [${tag}] ${message}${extra}\n`;

    this.writeToConsole(level, line);
    this.rotateIfNeeded(line.length);
    writeSync(this.fd, line);
  }

  private writeToConsole(level: LogLevelName, line: string): void {
    const trimmed = line.slice(0, -1);
    if (level === 'error') this.cons.error(trimmed);
    else if (level === 'warn') this.cons.warn(trimmed);
    else this.cons.log(trimmed);
  }

  private rotateIfNeeded(pendingBytes: number): void {
    const stat = fstatSync(this.fd!);
    if (stat.size + pendingBytes < this.maxFileSize) return;

    closeSync(this.fd!);

    const oldest = join(this.logsDir, `app.log.${this.maxFiles - 1}`);
    if (existsSync(oldest)) unlinkSync(oldest);

    for (let i = this.maxFiles - 2; i >= 0; i--) {
      const from = join(this.logsDir, `app.log.${i}`);
      if (existsSync(from)) renameSync(from, join(this.logsDir, `app.log.${i + 1}`));
    }

    renameSync(this.logPath, join(this.logsDir, 'app.log.0'));
    this.fd = openSync(this.logPath, 'a');
  }
}

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack ?? arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}
