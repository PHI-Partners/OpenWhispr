import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('electron', async () => import('../../tests/mocks/electron'));

import {
  BrowserWindow,
  resetElectronMock,
  simulateHeadersReceived,
  simulatePermissionCheck,
  simulatePermissionRequest,
  session,
} from '../../tests/mocks/electron';
import { configureContentSecurityPolicy, configurePermissions, hardenWindow } from './security';
import type { Logger } from './logger';

function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    close: vi.fn(),
  };
}

describe('security', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;
  const savedEnv = process.env.ELECTRON_RENDERER_URL;

  beforeEach(() => {
    resetElectronMock();
    delete process.env.ELECTRON_RENDERER_URL;
    mockLogger = createMockLogger();
  });

  afterEach(() => {
    if (savedEnv !== undefined) {
      process.env.ELECTRON_RENDERER_URL = savedEnv;
    } else {
      delete process.env.ELECTRON_RENDERER_URL;
    }
  });

  // ── CSP ──

  describe('configureContentSecurityPolicy', () => {
    it('registers onHeadersReceived on session.defaultSession.webRequest', () => {
      configureContentSecurityPolicy(mockLogger as unknown as Logger);
      expect(session.defaultSession.webRequest.onHeadersReceived).toHaveBeenCalledWith(expect.any(Function));
    });

    it('injects CSP header for file:// URLs', async () => {
      configureContentSecurityPolicy(mockLogger as unknown as Logger);
      const result = await simulateHeadersReceived({ url: 'file:///C:/app/index.html' });
      expect(result.responseHeaders).toHaveProperty('Content-Security-Policy');
      const csp = (result.responseHeaders!['Content-Security-Policy'] as string[])[0];
      expect(csp).toContain("default-src 'self'");
    });

    it('injects CSP header for dev server URLs when ELECTRON_RENDERER_URL is set', async () => {
      process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173';
      configureContentSecurityPolicy(mockLogger as unknown as Logger);
      const result = await simulateHeadersReceived({ url: 'http://localhost:5173/index.html' });
      expect(result.responseHeaders).toHaveProperty('Content-Security-Policy');
    });

    it('passes through external URLs without CSP', async () => {
      configureContentSecurityPolicy(mockLogger as unknown as Logger);
      const result = await simulateHeadersReceived({
        url: 'https://example.com/resource.js',
        responseHeaders: { 'X-Existing': ['value'] },
      });
      expect(result.responseHeaders).not.toHaveProperty('Content-Security-Policy');
      expect(result.responseHeaders).toEqual({ 'X-Existing': ['value'] });
    });

    it('production CSP omits unsafe-eval', async () => {
      configureContentSecurityPolicy(mockLogger as unknown as Logger);
      const result = await simulateHeadersReceived({ url: 'file:///app/index.html' });
      const csp = (result.responseHeaders!['Content-Security-Policy'] as string[])[0];
      expect(csp).not.toContain('unsafe-eval');
    });

    it('dev CSP includes unsafe-eval and ws: connect-src', async () => {
      process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173';
      configureContentSecurityPolicy(mockLogger as unknown as Logger);
      const result = await simulateHeadersReceived({ url: 'http://localhost:5173/' });
      const csp = (result.responseHeaders!['Content-Security-Policy'] as string[])[0];
      expect(csp).toContain("'unsafe-eval'");
      expect(csp).toContain('ws://localhost:*');
    });

    it('production CSP includes blob: and mediastream: in media-src', async () => {
      configureContentSecurityPolicy(mockLogger as unknown as Logger);
      const result = await simulateHeadersReceived({ url: 'file:///app/index.html' });
      const csp = (result.responseHeaders!['Content-Security-Policy'] as string[])[0];
      expect(csp).toContain('media-src');
      expect(csp).toContain('blob:');
      expect(csp).toContain('mediastream:');
    });

    it('logs CSP configuration', () => {
      configureContentSecurityPolicy(mockLogger as unknown as Logger);
      expect(mockLogger.info).toHaveBeenCalledWith('security', expect.stringContaining('CSP'));
    });
  });

  // ── Navigation lock-down ──

  describe('hardenWindow', () => {
    function createHardenedWindow() {
      const win = new BrowserWindow({});
      hardenWindow(win as unknown as import('electron').BrowserWindow, mockLogger as unknown as Logger);
      return win;
    }

    function getWillNavigateHandler(win: BrowserWindow) {
      const call = win.webContents.on.mock.calls.find((c: unknown[]) => c[0] === 'will-navigate');
      expect(call).toBeDefined();
      return call![1] as (details: { url: string; preventDefault: () => void }) => void;
    }

    it('allows will-navigate to file:// URLs', () => {
      const win = createHardenedWindow();
      const handler = getWillNavigateHandler(win);
      const preventDefault = vi.fn();
      handler({ url: 'file:///app/other.html', preventDefault });
      expect(preventDefault).not.toHaveBeenCalled();
    });

    it('allows will-navigate to ELECTRON_RENDERER_URL when set', () => {
      delete process.env.ELECTRON_RENDERER_URL;
      process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173';
      const win = new BrowserWindow({});
      hardenWindow(win as unknown as import('electron').BrowserWindow, mockLogger as unknown as Logger);
      const handler = getWillNavigateHandler(win);
      const preventDefault = vi.fn();
      handler({ url: 'http://localhost:5173/page', preventDefault });
      expect(preventDefault).not.toHaveBeenCalled();
    });

    it('blocks will-navigate to external URLs', () => {
      const win = createHardenedWindow();
      const handler = getWillNavigateHandler(win);
      const preventDefault = vi.fn();
      handler({ url: 'https://evil.com/phish', preventDefault });
      expect(preventDefault).toHaveBeenCalled();
    });

    it('logs blocked navigations', () => {
      const win = createHardenedWindow();
      const handler = getWillNavigateHandler(win);
      handler({ url: 'https://evil.com', preventDefault: vi.fn() });
      expect(mockLogger.warn).toHaveBeenCalledWith('security', expect.stringContaining('https://evil.com'));
    });

    it('sets setWindowOpenHandler to deny all', () => {
      const win = createHardenedWindow();
      expect(win.webContents.setWindowOpenHandler).toHaveBeenCalledWith(expect.any(Function));

      const openHandler = win.webContents.setWindowOpenHandler.mock.calls[0][0] as (details: {
        url: string;
      }) => { action: string };
      const result = openHandler({ url: 'https://example.com' });
      expect(result).toEqual({ action: 'deny' });
    });

    it('logs blocked window.open URLs', () => {
      const win = createHardenedWindow();
      const openHandler = win.webContents.setWindowOpenHandler.mock.calls[0][0] as (details: {
        url: string;
      }) => { action: string };
      openHandler({ url: 'https://popup.com' });
      expect(mockLogger.warn).toHaveBeenCalledWith('security', expect.stringContaining('https://popup.com'));
    });
  });

  // ── Permissions ──

  describe('configurePermissions', () => {
    beforeEach(() => {
      configurePermissions(mockLogger as unknown as Logger);
    });

    describe('setPermissionRequestHandler', () => {
      it('grants media permission for app origin', async () => {
        const granted = await simulatePermissionRequest('media', 'file:///app/index.html');
        expect(granted).toBe(true);
      });

      it('denies media permission for external origin', async () => {
        const granted = await simulatePermissionRequest('media', 'https://evil.com');
        expect(granted).toBe(false);
      });

      it('denies geolocation for app origin', async () => {
        const granted = await simulatePermissionRequest('geolocation', 'file:///app/index.html');
        expect(granted).toBe(false);
      });

      it('denies notifications for app origin', async () => {
        const granted = await simulatePermissionRequest('notifications', 'file:///app/index.html');
        expect(granted).toBe(false);
      });

      it('denies display-capture for app origin', async () => {
        const granted = await simulatePermissionRequest('display-capture', 'file:///app/index.html');
        expect(granted).toBe(false);
      });

      it('logs denied permissions', async () => {
        await simulatePermissionRequest('geolocation', 'file:///app/index.html');
        expect(mockLogger.warn).toHaveBeenCalledWith('security', expect.stringContaining('geolocation'));
      });
    });

    describe('setPermissionCheckHandler', () => {
      it('returns true for media from app origin', () => {
        expect(simulatePermissionCheck('media', 'file://')).toBe(true);
      });

      it('returns false for media from external origin', () => {
        expect(simulatePermissionCheck('media', 'https://evil.com')).toBe(false);
      });

      it('returns false for geolocation from app origin', () => {
        expect(simulatePermissionCheck('geolocation', 'file://')).toBe(false);
      });

      it('returns false for display-capture from app origin', () => {
        expect(simulatePermissionCheck('display-capture', 'file://')).toBe(false);
      });

      it('returns false for notifications from app origin', () => {
        expect(simulatePermissionCheck('notifications', 'file://')).toBe(false);
      });
    });

    describe('permission matrix', () => {
      const matrix = [
        { permission: 'media', origin: 'file://', expected: true },
        { permission: 'media', origin: 'https://evil.com', expected: false },
        { permission: 'display-capture', origin: 'file://', expected: false },
        { permission: 'geolocation', origin: 'file://', expected: false },
        { permission: 'notifications', origin: 'file://', expected: false },
        { permission: 'clipboard-read', origin: 'file://', expected: false },
        { permission: 'usb', origin: 'file://', expected: false },
        { permission: 'serial', origin: 'file://', expected: false },
      ];

      it.each(matrix)('check: $permission from $origin → $expected', ({ permission, origin, expected }) => {
        expect(simulatePermissionCheck(permission, origin)).toBe(expected);
      });
    });

    it('logs configuration', () => {
      expect(mockLogger.info).toHaveBeenCalledWith(
        'security',
        expect.stringContaining('Permission handlers configured'),
      );
    });
  });
});
