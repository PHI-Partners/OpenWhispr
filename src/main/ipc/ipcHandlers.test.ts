import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', async () => import('../../../tests/mocks/electron'));

import { resetElectronMock, simulateInvoke } from '../../../tests/mocks/electron';
import { registerIpcHandlers } from './ipcHandlers';
import type { Logger } from '../logger';
import type { RendererErrorPayload } from '@shared/ipc';

function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    close: vi.fn(),
  };
}

describe('registerIpcHandlers', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    resetElectronMock();
    mockLogger = createMockLogger();
    registerIpcHandlers({ logger: mockLogger as unknown as Logger });
  });

  describe('log-renderer-error', () => {
    it('registers the handler', async () => {
      const payload: RendererErrorPayload = {
        message: 'test error',
        stack: null,
        source: 'error',
      };
      await expect(simulateInvoke('log-renderer-error', payload)).resolves.not.toThrow();
    });

    it('forwards renderer error to logger.error with renderer tag', async () => {
      const payload: RendererErrorPayload = {
        message: 'Something broke',
        stack: null,
        source: 'error',
      };
      await simulateInvoke('log-renderer-error', payload);

      expect(mockLogger.error).toHaveBeenCalledWith('renderer', '[error] Something broke');
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
      const payload: RendererErrorPayload = {
        message: 'no stack',
        stack: null,
        source: 'error',
      };
      await simulateInvoke('log-renderer-error', payload);

      const call = mockLogger.error.mock.calls[0];
      expect(call?.[1]).not.toContain('null');
      expect(call?.[1]).toBe('[error] no stack');
    });
  });
});
