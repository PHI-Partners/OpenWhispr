import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from '../../tests/helpers/tempDir';
import { Logger } from './logger';

function createMockConsole() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function readLog(logsDir: string, name = 'app.log'): string {
  return readFileSync(join(logsDir, name), 'utf-8');
}

describe('Logger', () => {
  let logsDir: string;
  let mockConsole: ReturnType<typeof createMockConsole>;

  beforeEach(async () => {
    logsDir = await makeTempDir('ow-logger-');
    mockConsole = createMockConsole();
  });

  describe('constructor', () => {
    it('creates logsDir if it does not exist', () => {
      const nested = join(logsDir, 'sub', 'logs');
      const logger = new Logger({ logsDir: nested, console: mockConsole });
      logger.info('test', 'hello');
      logger.close();
      expect(existsSync(join(nested, 'app.log'))).toBe(true);
    });
  });

  describe('log format', () => {
    it('writes timestamped formatted lines', () => {
      const logger = new Logger({ logsDir, console: mockConsole });
      logger.info('mytag', 'hello world');
      logger.close();

      const content = readLog(logsDir);
      expect(content).toMatch(
        /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO\] \[mytag\] hello world\n$/,
      );
    });

    it('appends extra args to the message', () => {
      const logger = new Logger({ logsDir, console: mockConsole });
      logger.info('tag', 'count:', 42, { key: 'val' });
      logger.close();

      const content = readLog(logsDir);
      expect(content).toContain('count: 42 {"key":"val"}');
    });
  });

  describe('level filtering', () => {
    it('filters debug messages at default info level', () => {
      const logger = new Logger({ logsDir, console: mockConsole });
      logger.debug('tag', 'should not appear');
      logger.info('tag', 'should appear');
      logger.close();

      const content = readLog(logsDir);
      expect(content).not.toContain('should not appear');
      expect(content).toContain('should appear');
    });

    it('writes debug messages when level is debug', () => {
      const logger = new Logger({ logsDir, level: 'debug', console: mockConsole });
      logger.debug('tag', 'visible');
      logger.close();

      const content = readLog(logsDir);
      expect(content).toContain('[DEBUG] [tag] visible');
    });

    it('all four levels write when level is debug', () => {
      const logger = new Logger({ logsDir, level: 'debug', console: mockConsole });
      logger.debug('t', 'd');
      logger.info('t', 'i');
      logger.warn('t', 'w');
      logger.error('t', 'e');
      logger.close();

      const content = readLog(logsDir);
      expect(content).toContain('[DEBUG]');
      expect(content).toContain('[INFO]');
      expect(content).toContain('[WARN]');
      expect(content).toContain('[ERROR]');
    });

    it('error level suppresses info and warn', () => {
      const logger = new Logger({ logsDir, level: 'error', console: mockConsole });
      logger.info('t', 'no');
      logger.warn('t', 'no');
      logger.error('t', 'yes');
      logger.close();

      const content = readLog(logsDir);
      expect(content).not.toContain('[INFO]');
      expect(content).not.toContain('[WARN]');
      expect(content).toContain('[ERROR]');
    });
  });

  describe('console output', () => {
    it('writes to console as well as file', () => {
      const logger = new Logger({ logsDir, console: mockConsole });
      logger.info('tag', 'msg');
      logger.close();

      expect(mockConsole.log).toHaveBeenCalledTimes(1);
      expect(mockConsole.log.mock.calls[0]?.[0]).toContain('[INFO] [tag] msg');
    });

    it('maps info and debug to console.log', () => {
      const logger = new Logger({ logsDir, level: 'debug', console: mockConsole });
      logger.debug('t', 'd');
      logger.info('t', 'i');
      logger.close();

      expect(mockConsole.log).toHaveBeenCalledTimes(2);
    });

    it('maps warn to console.warn', () => {
      const logger = new Logger({ logsDir, console: mockConsole });
      logger.warn('t', 'w');
      logger.close();

      expect(mockConsole.warn).toHaveBeenCalledTimes(1);
    });

    it('maps error to console.error', () => {
      const logger = new Logger({ logsDir, console: mockConsole });
      logger.error('t', 'e');
      logger.close();

      expect(mockConsole.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('rotation', () => {
    const SMALL_MAX = 200;

    function fillLogger(logger: Logger, lineCount: number, lineContent = 'x'.repeat(50)): void {
      for (let i = 0; i < lineCount; i++) {
        logger.info('fill', lineContent);
      }
    }

    it('rotates when file exceeds maxFileSize', () => {
      const logger = new Logger({
        logsDir,
        maxFileSize: SMALL_MAX,
        maxFiles: 3,
        console: mockConsole,
      });
      fillLogger(logger, 10);
      logger.close();

      expect(existsSync(join(logsDir, 'app.log'))).toBe(true);
      expect(existsSync(join(logsDir, 'app.log.0'))).toBe(true);
    });

    it('keeps at most maxFiles rotated files', () => {
      const logger = new Logger({
        logsDir,
        maxFileSize: SMALL_MAX,
        maxFiles: 2,
        console: mockConsole,
      });
      fillLogger(logger, 30);
      logger.close();

      const logFiles = readdirSync(logsDir).filter((f) => f.startsWith('app.log'));
      // app.log + app.log.0 + app.log.1 = maxFiles + 1 (the current file plus maxFiles rotated)
      expect(logFiles.length).toBeLessThanOrEqual(3);
    });

    it('oldest file is deleted during rotation', () => {
      const logger = new Logger({
        logsDir,
        maxFileSize: SMALL_MAX,
        maxFiles: 2,
        console: mockConsole,
      });
      fillLogger(logger, 50);
      logger.close();

      expect(existsSync(join(logsDir, 'app.log.2'))).toBe(false);
    });
  });

  describe('close', () => {
    it('is idempotent', () => {
      const logger = new Logger({ logsDir, console: mockConsole });
      logger.info('t', 'msg');
      logger.close();
      expect(() => logger.close()).not.toThrow();
    });

    it('does not write after close', () => {
      const logger = new Logger({ logsDir, console: mockConsole });
      logger.info('t', 'before');
      logger.close();
      logger.info('t', 'after');

      const content = readLog(logsDir);
      expect(content).toContain('before');
      expect(content).not.toContain('after');
    });
  });
});
