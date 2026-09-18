import { beforeEach, describe, expect, it } from 'vitest';
import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  Menu,
  resetElectronMock,
  sentMessages,
  session,
  simulateHeadersReceived,
  simulateInvoke,
  simulateInvokeFrom,
  simulateInvokeWithNullFrame,
  simulatePermissionCheck,
  simulatePermissionRequest,
  Tray,
} from './electron';

describe('Electron mock', () => {
  beforeEach(() => {
    resetElectronMock();
  });

  describe('app', () => {
    it('returns mock paths from getPath', () => {
      expect(typeof app.getPath('userData')).toBe('string');
    });

    it('resolves whenReady', async () => {
      await expect(app.whenReady()).resolves.toBeUndefined();
    });

    it('reports not packaged by default', () => {
      expect(app.isPackaged).toBe(false);
    });

    it('returns mock app path from getAppPath', () => {
      expect(typeof app.getAppPath()).toBe('string');
    });

    it('resetElectronMock restores isPackaged to false', () => {
      app.isPackaged = true;
      resetElectronMock();
      expect(app.isPackaged).toBe(false);
    });
  });

  describe('ipcMain + simulateInvoke', () => {
    it('stores handlers via handle()', () => {
      const handler = () => Promise.resolve('result');
      ipcMain.handle('test-channel', handler);
      expect(ipcMain.handle).toHaveBeenCalledWith('test-channel', handler);
    });

    it('simulateInvoke calls the registered handler with a sender frame', async () => {
      ipcMain.handle('my-channel', (...args: unknown[]) => {
        const event = args[0] as { senderFrame: { url: string } };
        const arg = args[1] as number;
        expect(event.senderFrame.url).toMatch(/^file:\/\//);
        return arg * 2;
      });
      const result = await simulateInvoke('my-channel', 21);
      expect(result).toBe(42);
    });

    it('simulateInvoke throws for unregistered channel', async () => {
      await expect(simulateInvoke('no-such-channel')).rejects.toThrow('No handler');
    });

    it('removeHandler removes the handler', async () => {
      ipcMain.handle('temp', () => 'ok');
      ipcMain.removeHandler('temp');
      await expect(simulateInvoke('temp')).rejects.toThrow('No handler');
    });
  });

  describe('BrowserWindow', () => {
    it('records messages sent via webContents.send', () => {
      const win = new BrowserWindow({});
      win.webContents.send('transcript-update', { text: 'hello' });

      expect(win.webContents.send).toHaveBeenCalledWith('transcript-update', { text: 'hello' });
      expect(sentMessages).toEqual([{ channel: 'transcript-update', args: [{ text: 'hello' }] }]);
    });

    it('provides loadURL and loadFile', async () => {
      const win = new BrowserWindow({});
      await win.loadURL('http://localhost:5173');
      await win.loadFile('index.html');
      expect(win.loadURL).toHaveBeenCalled();
      expect(win.loadFile).toHaveBeenCalled();
    });

    it('tracks messages across windows', () => {
      const win1 = new BrowserWindow({});
      const win2 = new BrowserWindow({});
      win1.webContents.send('ch1', 'a');
      win2.webContents.send('ch2', 'b');
      expect(sentMessages).toHaveLength(2);
      expect(sentMessages[0]).toEqual({ channel: 'ch1', args: ['a'] });
      expect(sentMessages[1]).toEqual({ channel: 'ch2', args: ['b'] });
    });
  });

  describe('Tray', () => {
    it('constructs and provides menu/tooltip methods', () => {
      const tray = new Tray('icon.png');
      tray.setToolTip('Test');
      tray.setContextMenu(null);
      expect(tray.setToolTip).toHaveBeenCalledWith('Test');
    });
  });

  describe('Menu', () => {
    it('builds from template', () => {
      const template = [{ label: 'Quit' }];
      const menu = Menu.buildFromTemplate(template);
      expect(menu).toBeDefined();
      expect(Menu.buildFromTemplate).toHaveBeenCalledWith(template);
    });
  });

  describe('globalShortcut', () => {
    it('register returns true by default', () => {
      const cb = () => {};
      expect(globalShortcut.register('Control+Alt+M', cb)).toBe(true);
    });

    it('tracks registered accelerators', () => {
      globalShortcut.register('Control+Alt+M', () => {});
      expect(globalShortcut.isRegistered('Control+Alt+M')).toBe(true);
    });

    it('unregisterAll clears registrations', () => {
      globalShortcut.register('Control+Alt+M', () => {});
      globalShortcut.unregisterAll();
      expect(globalShortcut.isRegistered('Control+Alt+M')).toBe(false);
    });
  });

  describe('simulateInvokeFrom', () => {
    it('passes custom sender URL to handler', async () => {
      ipcMain.handle('test', (...args: unknown[]) => {
        const event = args[0] as { senderFrame: { url: string } };
        return event.senderFrame.url;
      });
      const result = await simulateInvokeFrom('http://evil.com/page', 'test');
      expect(result).toBe('http://evil.com/page');
    });

    it('derives file:// origin for file: URLs', async () => {
      ipcMain.handle('test', (...args: unknown[]) => {
        const event = args[0] as { senderFrame: { origin: string } };
        return event.senderFrame.origin;
      });
      const result = await simulateInvokeFrom('file:///C:/app/index.html', 'test');
      expect(result).toBe('file://');
    });

    it('derives http origin for http URLs', async () => {
      ipcMain.handle('test', (...args: unknown[]) => {
        const event = args[0] as { senderFrame: { origin: string } };
        return event.senderFrame.origin;
      });
      const result = await simulateInvokeFrom('http://localhost:5173/index.html', 'test');
      expect(result).toBe('http://localhost:5173');
    });

    it('rejects for unregistered channel', async () => {
      await expect(simulateInvokeFrom('file:///app', 'nope')).rejects.toThrow('No handler');
    });
  });

  describe('simulateInvokeWithNullFrame', () => {
    it('passes null senderFrame to handler', async () => {
      ipcMain.handle('test', (...args: unknown[]) => {
        const event = args[0] as { senderFrame: unknown };
        return event.senderFrame;
      });
      const result = await simulateInvokeWithNullFrame('test');
      expect(result).toBeNull();
    });
  });

  describe('session', () => {
    it('provides permission handlers on defaultSession', () => {
      session.defaultSession.setPermissionRequestHandler(() => {});
      expect(session.defaultSession.setPermissionRequestHandler).toHaveBeenCalled();
    });

    it('provides webRequest.onHeadersReceived', () => {
      session.defaultSession.webRequest.onHeadersReceived(() => {});
      expect(session.defaultSession.webRequest.onHeadersReceived).toHaveBeenCalled();
    });
  });

  describe('simulatePermissionRequest', () => {
    it('invokes stored permission request handler', async () => {
      session.defaultSession.setPermissionRequestHandler(
        (_wc: unknown, permission: string, callback: (granted: boolean) => void) => {
          callback(permission === 'media');
        },
      );
      expect(await simulatePermissionRequest('media', 'file:///app')).toBe(true);
      expect(await simulatePermissionRequest('geolocation', 'file:///app')).toBe(false);
    });

    it('throws when no handler is registered', async () => {
      await expect(simulatePermissionRequest('media', 'file:///app')).rejects.toThrow(
        'No permission request handler',
      );
    });
  });

  describe('simulatePermissionCheck', () => {
    it('invokes stored permission check handler', () => {
      session.defaultSession.setPermissionCheckHandler(
        (_wc: unknown, permission: string) => permission === 'media',
      );
      expect(simulatePermissionCheck('media', 'file://')).toBe(true);
      expect(simulatePermissionCheck('geolocation', 'file://')).toBe(false);
    });

    it('throws when no handler is registered', () => {
      expect(() => simulatePermissionCheck('media', 'file://')).toThrow('No permission check handler');
    });
  });

  describe('simulateHeadersReceived', () => {
    it('invokes stored onHeadersReceived handler', async () => {
      session.defaultSession.webRequest.onHeadersReceived(
        (
          details: { url: string },
          callback: (resp: { responseHeaders?: Record<string, string[]> }) => void,
        ) => {
          callback({ responseHeaders: { 'X-Test': [details.url] } });
        },
      );
      const result = await simulateHeadersReceived({ url: 'file:///app/index.html' });
      expect(result.responseHeaders).toEqual({ 'X-Test': ['file:///app/index.html'] });
    });

    it('throws when no handler is registered', async () => {
      await expect(simulateHeadersReceived({ url: 'file:///x' })).rejects.toThrow(
        'No onHeadersReceived handler',
      );
    });
  });

  describe('desktopCapturer', () => {
    it('returns mock screen sources', async () => {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      expect(sources.length).toBeGreaterThan(0);
      expect(sources[0].id).toMatch(/^screen:/);
    });
  });
});
