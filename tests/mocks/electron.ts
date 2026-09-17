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

export function simulateInvoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel);
  if (!handler) return Promise.reject(new Error(`No handler registered for channel: ${channel}`));
  const event = {
    senderFrame: { url: 'file:///app/index.html' },
    sender: { id: 1 },
  };
  return Promise.resolve(handler(event, ...args));
}

// ── BrowserWindow ──

export class BrowserWindow {
  readonly webContents = {
    send: vi.fn((...sendArgs: [string, ...unknown[]]) => {
      sentMessages.push({ channel: sendArgs[0], args: sendArgs.slice(1) });
    }),
    id: 1,
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

export const session = {
  defaultSession: {
    setPermissionRequestHandler: vi.fn((_handler: unknown) => {}),
    setPermissionCheckHandler: vi.fn((_handler: unknown) => {}),
    setDisplayMediaRequestHandler: vi.fn((_handler: unknown) => {}),
  },
};

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
}
