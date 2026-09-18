import { vi } from 'vitest';

// ── Sent-message recorder (shared across BrowserWindow instances) ──

export interface SentMessage {
  channel: string;
  args: unknown[];
}

export const sentMessages: SentMessage[] = [];

// ── app ──

export const app = {
  getPath: vi.fn((name: string) => `/mock/${name}`),
  isPackaged: false,
  whenReady: vi.fn((): Promise<void> => Promise.resolve()),
  on: vi.fn(),
  quit: vi.fn(),
  getName: vi.fn(() => 'OpenWhispr'),
  getVersion: vi.fn(() => '0.1.0'),
  getAppPath: vi.fn(() => '/mock/app'),
};

// ── ipcMain ──

const handlers = new Map<string, (...args: unknown[]) => unknown>();

export const ipcMain = {
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    handlers.set(channel, handler);
  }),
  removeHandler: vi.fn((channel: string) => {
    handlers.delete(channel);
  }),
};

function deriveOrigin(url: string): string {
  if (url.startsWith('file:')) return 'file://';
  try {
    return new URL(url).origin;
  } catch {
    return 'null';
  }
}

export function simulateInvoke(channel: string, ...args: unknown[]): Promise<unknown> {
  return simulateInvokeFrom('file:///app/index.html', channel, ...args);
}

export function simulateInvokeFrom(senderUrl: string, channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel);
  if (!handler) return Promise.reject(new Error(`No handler registered for channel: ${channel}`));
  const event = {
    senderFrame: { url: senderUrl, origin: deriveOrigin(senderUrl) },
    sender: { id: 1 },
  };
  return Promise.resolve(handler(event, ...args));
}

export function simulateInvokeWithNullFrame(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel);
  if (!handler) return Promise.reject(new Error(`No handler registered for channel: ${channel}`));
  const event = { senderFrame: null, sender: { id: 1 } };
  return Promise.resolve(handler(event, ...args));
}

// ── BrowserWindow ──

export class BrowserWindow {
  readonly webContents = {
    send: vi.fn((...sendArgs: [string, ...unknown[]]) => {
      sentMessages.push({ channel: sendArgs[0], args: sendArgs.slice(1) });
    }),
    id: 1,
    getURL: vi.fn(() => 'file:///app/index.html'),
    on: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  };

  constructor(_opts?: Record<string, unknown>) {}

  loadURL = vi.fn(async (_url: string): Promise<void> => {});
  loadFile = vi.fn(async (_path: string): Promise<void> => {});
  show = vi.fn();
  hide = vi.fn();
  close = vi.fn();
  destroy = vi.fn();
  on = vi.fn();
  once = vi.fn();
  isDestroyed = vi.fn(() => false);
  isVisible = vi.fn(() => true);
  setAlwaysOnTop = vi.fn();
  setBounds = vi.fn();

  static getAllWindows = vi.fn((): BrowserWindow[] => []);
  static fromWebContents = vi.fn((): BrowserWindow | undefined => undefined);
}

// ── Tray ──

export class Tray {
  constructor(_iconPath: string) {}
  setToolTip = vi.fn();
  setContextMenu = vi.fn();
  setImage = vi.fn();
  on = vi.fn();
  destroy = vi.fn();
}

// ── Menu ──

export const Menu = {
  buildFromTemplate: vi.fn((template: unknown[]) => ({ items: template })),
  setApplicationMenu: vi.fn(),
};

// ── globalShortcut ──

const registeredShortcuts = new Map<string, () => void>();

export const globalShortcut = {
  register: vi.fn((accelerator: string, callback: () => void): boolean => {
    registeredShortcuts.set(accelerator, callback);
    return true;
  }),
  unregister: vi.fn((accelerator: string) => {
    registeredShortcuts.delete(accelerator);
  }),
  unregisterAll: vi.fn(() => {
    registeredShortcuts.clear();
  }),
  isRegistered: vi.fn((accelerator: string): boolean => registeredShortcuts.has(accelerator)),
};

// ── session ──

type PermissionRequestHandler = (
  webContents: unknown,
  permission: string,
  callback: (granted: boolean) => void,
  details: { requestingUrl?: string },
) => void;

type PermissionCheckHandler = (
  webContents: unknown,
  permission: string,
  requestingOrigin: string,
  details: unknown,
) => boolean;

type HeadersReceivedHandler = (
  details: { url: string; responseHeaders?: Record<string, string[]> },
  callback: (response: { responseHeaders?: Record<string, string | string[]>; cancel?: boolean }) => void,
) => void;

let permissionRequestHandler: PermissionRequestHandler | null = null;
let permissionCheckHandler: PermissionCheckHandler | null = null;
let headersReceivedHandler: HeadersReceivedHandler | null = null;

export const session = {
  defaultSession: {
    setPermissionRequestHandler: vi.fn((handler: PermissionRequestHandler | null) => {
      permissionRequestHandler = handler;
    }),
    setPermissionCheckHandler: vi.fn((handler: PermissionCheckHandler | null) => {
      permissionCheckHandler = handler;
    }),
    setDisplayMediaRequestHandler: vi.fn((_handler: unknown) => {}),
    webRequest: {
      onHeadersReceived: vi.fn((handler: HeadersReceivedHandler | null) => {
        headersReceivedHandler = handler;
      }),
    },
  },
};

export function simulatePermissionRequest(permission: string, requestingUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!permissionRequestHandler) throw new Error('No permission request handler registered');
    const fakeWebContents = { getURL: () => requestingUrl };
    permissionRequestHandler(fakeWebContents, permission, resolve, { requestingUrl });
  });
}

export function simulatePermissionCheck(permission: string, requestingOrigin: string): boolean {
  if (!permissionCheckHandler) throw new Error('No permission check handler registered');
  return permissionCheckHandler(null, permission, requestingOrigin, {});
}

export function simulateHeadersReceived(details: {
  url: string;
  responseHeaders?: Record<string, string[]>;
}): Promise<{ responseHeaders?: Record<string, string | string[]>; cancel?: boolean }> {
  return new Promise((resolve) => {
    if (!headersReceivedHandler) throw new Error('No onHeadersReceived handler registered');
    headersReceivedHandler(details, resolve);
  });
}

// ── desktopCapturer ──

export const desktopCapturer = {
  getSources: vi.fn((_opts: unknown) =>
    Promise.resolve([
      {
        id: 'screen:1:0',
        name: 'Entire Screen',
        thumbnail: { toDataURL: () => '' },
        display_id: '1',
        appIcon: null,
      },
    ]),
  ),
};

// ── contextBridge & ipcRenderer (for preload tests) ──

export const contextBridge = {
  exposeInMainWorld: vi.fn(),
};

const ipcRendererListeners = new Map<string, Set<(...args: unknown[]) => void>>();

export const ipcRenderer = {
  invoke: vi.fn(() => Promise.resolve(undefined)),
  on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
    if (!ipcRendererListeners.has(channel)) ipcRendererListeners.set(channel, new Set());
    ipcRendererListeners.get(channel)!.add(listener);
    return ipcRenderer;
  }),
  removeListener: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
    ipcRendererListeners.get(channel)?.delete(listener);
    return ipcRenderer;
  }),
};

// ── Reset (call in beforeEach to clear shared state between tests) ──

export function resetElectronMock(): void {
  sentMessages.length = 0;
  handlers.clear();
  registeredShortcuts.clear();
  ipcRendererListeners.clear();
  permissionRequestHandler = null;
  permissionCheckHandler = null;
  headersReceivedHandler = null;
  app.isPackaged = false;
  app.getPath.mockImplementation((name: string) => `/mock/${name}`);
  app.getAppPath.mockReturnValue('/mock/app');
}
