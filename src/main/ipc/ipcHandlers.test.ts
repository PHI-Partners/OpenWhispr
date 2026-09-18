import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('electron', async () => import('../../../tests/mocks/electron'));

import {
  resetElectronMock,
  simulateInvoke,
  simulateInvokeFrom,
  simulateInvokeWithNullFrame,
  ipcMain,
} from '../../../tests/mocks/electron';
import { registerIpcHandlers } from './ipcHandlers';
import type { Logger } from '../logger';
import { EventChannel, InvokeChannel, type RendererErrorPayload } from '@shared/ipc';

function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    close: vi.fn(),
  };
}

const validPayload: RendererErrorPayload = {
  message: 'test error',
  stack: null,
  source: 'error',
};

describe('registerIpcHandlers', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;
  const savedEnv = process.env.ELECTRON_RENDERER_URL;

  beforeEach(() => {
    resetElectronMock();
    delete process.env.ELECTRON_RENDERER_URL;
    mockLogger = createMockLogger();
    registerIpcHandlers({ logger: mockLogger as unknown as Logger });
  });

  afterEach(() => {
    if (savedEnv !== undefined) {
      process.env.ELECTRON_RENDERER_URL = savedEnv;
    } else {
      delete process.env.ELECTRON_RENDERER_URL;
    }
  });

  // ── Origin validation ──

  describe('origin validation', () => {
    it('accepts invoke from file:// URL', async () => {
      await expect(simulateInvoke('log-renderer-error', validPayload)).resolves.not.toThrow();
    });

    it('rejects invoke from http://evil.com', async () => {
      await expect(
        simulateInvokeFrom('http://evil.com/page', 'log-renderer-error', validPayload),
      ).rejects.toThrow('origin not allowed');
    });

    it('rejects invoke from about:blank', async () => {
      await expect(simulateInvokeFrom('about:blank', 'log-renderer-error', validPayload)).rejects.toThrow(
        'origin not allowed',
      );
    });

    it('accepts invoke from ELECTRON_RENDERER_URL when set', async () => {
      resetElectronMock();
      process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173';
      registerIpcHandlers({ logger: mockLogger as unknown as Logger });

      await expect(
        simulateInvokeFrom('http://localhost:5173/index.html', 'log-renderer-error', validPayload),
      ).resolves.not.toThrow();
    });

    it('rejects invoke from different dev server port', async () => {
      resetElectronMock();
      process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173';
      registerIpcHandlers({ logger: mockLogger as unknown as Logger });

      await expect(
        simulateInvokeFrom('http://localhost:9999/index.html', 'log-renderer-error', validPayload),
      ).rejects.toThrow('origin not allowed');
    });

    it('rejects invoke with null senderFrame', async () => {
      await expect(simulateInvokeWithNullFrame('log-renderer-error', validPayload)).rejects.toThrow(
        'missing sender frame',
      );
    });

    it('logs rejected origin', async () => {
      await simulateInvokeFrom('http://evil.com', 'log-renderer-error', validPayload).catch(() => {});
      expect(mockLogger.warn).toHaveBeenCalledWith('ipc', expect.stringContaining('origin not allowed'));
    });
  });

  // ── Argument validation ──

  describe('argument validation', () => {
    describe('log-renderer-error', () => {
      it('rejects when payload is not an object', async () => {
        await expect(simulateInvoke('log-renderer-error', 'not-an-object')).rejects.toThrow(
          'payload must be an object',
        );
      });

      it('rejects when payload.message is not a string', async () => {
        await expect(
          simulateInvoke('log-renderer-error', { message: 42, stack: null, source: 'error' }),
        ).rejects.toThrow('payload.message must be a string');
      });

      it('rejects when payload.source is invalid', async () => {
        await expect(
          simulateInvoke('log-renderer-error', {
            message: 'x',
            stack: null,
            source: 'unknown',
          }),
        ).rejects.toThrow('payload.source must be');
      });

      it('rejects when payload.stack is not string or null', async () => {
        await expect(
          simulateInvoke('log-renderer-error', { message: 'x', stack: 123, source: 'error' }),
        ).rejects.toThrow('payload.stack must be');
      });

      it('accepts valid payload with null stack', async () => {
        await expect(simulateInvoke('log-renderer-error', validPayload)).resolves.not.toThrow();
      });

      it('accepts valid payload with string stack', async () => {
        await expect(
          simulateInvoke('log-renderer-error', { ...validPayload, stack: 'Error\n  at x:1' }),
        ).resolves.not.toThrow();
      });
    });

    describe('db-get-meeting', () => {
      it('rejects when id is not a number', async () => {
        await expect(simulateInvoke('db-get-meeting', 'abc')).rejects.toThrow('id must be a number');
      });

      it('rejects when id is a float', async () => {
        await expect(simulateInvoke('db-get-meeting', 1.5)).rejects.toThrow('id must be an integer');
      });

      it('rejects when id is zero', async () => {
        await expect(simulateInvoke('db-get-meeting', 0)).rejects.toThrow('id must be a positive integer');
      });

      it('rejects when id is negative', async () => {
        await expect(simulateInvoke('db-get-meeting', -1)).rejects.toThrow('id must be a positive integer');
      });
    });

    describe('no-argument channels', () => {
      it('meeting-recording-start rejects extra arguments', async () => {
        await expect(simulateInvoke('meeting-recording-start', 'extra')).rejects.toThrow(
          'expected no arguments',
        );
      });

      it('meeting-recording-stop rejects extra arguments', async () => {
        await expect(simulateInvoke('meeting-recording-stop', 'extra')).rejects.toThrow(
          'expected no arguments',
        );
      });

      it('db-list-meetings rejects extra arguments', async () => {
        await expect(simulateInvoke('db-list-meetings', 'extra')).rejects.toThrow('expected no arguments');
      });
    });
  });

  // ── Error serialization ──

  describe('error serialization', () => {
    it('rethrows validation errors with message preserved', async () => {
      await expect(simulateInvoke('db-get-meeting', 'abc')).rejects.toThrow(
        'IPC validation failed on "db-get-meeting": id must be a number',
      );
    });

    it('logs validation failures via logger.warn', async () => {
      await simulateInvoke('db-get-meeting', 'abc').catch(() => {});
      expect(mockLogger.warn).toHaveBeenCalledWith('ipc', expect.stringContaining('id must be a number'));
    });

    it('logs handler errors via logger.error', async () => {
      await simulateInvoke('meeting-recording-start').catch(() => {});
      expect(mockLogger.error).toHaveBeenCalledWith('ipc', expect.stringContaining('Not implemented'));
    });

    it('wraps handler errors as serializable Error', async () => {
      const rejection = simulateInvoke('meeting-recording-start');
      await expect(rejection).rejects.toThrow('Not implemented');
      await expect(rejection).rejects.toBeInstanceOf(Error);
    });
  });

  // ── Existing log-renderer-error behaviour ──

  describe('log-renderer-error', () => {
    it('forwards renderer error to logger.error with renderer tag', async () => {
      await simulateInvoke('log-renderer-error', validPayload);
      expect(mockLogger.error).toHaveBeenCalledWith('renderer', '[error] test error');
    });

    it('includes stack trace when present', async () => {
      const payload: RendererErrorPayload = {
        message: 'Error happened',
        stack: 'Error: Error happened\n    at foo.js:1:1',
        source: 'unhandledrejection',
      };
      await simulateInvoke('log-renderer-error', payload);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'renderer',
        '[unhandledrejection] Error happened\nError: Error happened\n    at foo.js:1:1',
      );
    });

    it('handles null stack gracefully', async () => {
      await simulateInvoke('log-renderer-error', {
        message: 'no stack',
        stack: null,
        source: 'error',
      });
      const call = mockLogger.error.mock.calls[0];
      expect(call?.[1]).not.toContain('null');
      expect(call?.[1]).toBe('[error] no stack');
    });
  });

  // ── Stub handlers ──

  describe('stub handlers', () => {
    it('meeting-recording-start throws "Not implemented"', async () => {
      await expect(simulateInvoke('meeting-recording-start')).rejects.toThrow('Not implemented');
    });

    it('meeting-recording-stop throws "Not implemented"', async () => {
      await expect(simulateInvoke('meeting-recording-stop')).rejects.toThrow('Not implemented');
    });

    it('db-list-meetings throws "Not implemented"', async () => {
      await expect(simulateInvoke('db-list-meetings')).rejects.toThrow('Not implemented');
    });

    it('db-get-meeting throws "Not implemented"', async () => {
      await expect(simulateInvoke('db-get-meeting', 1)).rejects.toThrow('Not implemented');
    });
  });

  // ── IPC contract completeness ──

  describe('IPC contract', () => {
    it('every InvokeChannel has exactly one registered handler', () => {
      const invokeChannels = Object.values(InvokeChannel);
      for (const channel of invokeChannels) {
        expect(ipcMain.handle).toHaveBeenCalledWith(channel, expect.any(Function));
      }
    });

    it('no extra channels beyond InvokeChannel are registered', () => {
      const invokeChannels = new Set(Object.values(InvokeChannel) as string[]);
      const registeredChannels = ipcMain.handle.mock.calls.map((call: unknown[]) => call[0] as string);
      for (const channel of registeredChannels) {
        expect(invokeChannels.has(channel)).toBe(true);
      }
    });

    it('registered channel count matches InvokeChannel count', () => {
      const invokeChannels = Object.values(InvokeChannel);
      const registeredChannels = ipcMain.handle.mock.calls;
      expect(registeredChannels).toHaveLength(invokeChannels.length);
    });

    it('every EventChannel has a matching on* method in Api', () => {
      const eventChannels = Object.values(EventChannel);
      expect(eventChannels).toHaveLength(1);
      expect(eventChannels).toContain('transcript-update');
    });
  });
});
