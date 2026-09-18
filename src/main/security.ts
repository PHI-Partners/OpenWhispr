import { type BrowserWindow, session } from 'electron';
import type { Logger } from './logger';

// ── Origin helpers ──

function getAppOriginPrefixes(): string[] {
  const prefixes = ['file://'];
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) prefixes.push(devUrl);
  return prefixes;
}

function isAppUrl(url: string, prefixes: string[]): boolean {
  return prefixes.some((p) => url.startsWith(p));
}

// ── Content Security Policy ──

function buildCspPolicy(): string {
  const isDev = !!process.env.ELECTRON_RENDERER_URL;

  const directives: Record<string, string> = {
    'default-src': "'self'",
    'script-src': isDev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self'",
    'style-src': "'self' 'unsafe-inline'",
    'img-src': "'self' data:",
    'font-src': "'self'",
    'media-src': "'self' blob: mediastream:",
    'connect-src': isDev ? "'self' ws://localhost:*" : "'self'",
    'object-src': "'none'",
    'base-uri': "'self'",
    'form-action': "'self'",
    'frame-ancestors': "'none'",
  };

  return Object.entries(directives)
    .map(([key, value]) => `${key} ${value}`)
    .join('; ');
}

export function configureContentSecurityPolicy(logger: Logger): void {
  const csp = buildCspPolicy();

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (isAppUrl(details.url, getAppOriginPrefixes())) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [csp],
        },
      });
    } else {
      callback({ responseHeaders: details.responseHeaders });
    }
  });

  logger.info('security', `CSP configured (dev=${!!process.env.ELECTRON_RENDERER_URL})`);
}

// ── Navigation lock-down ──

export function hardenWindow(window: BrowserWindow, logger: Logger): void {
  const prefixes = getAppOriginPrefixes();

  window.webContents.on('will-navigate', (details) => {
    if (!isAppUrl(details.url, prefixes)) {
      details.preventDefault();
      logger.warn('security', `Blocked navigation to ${details.url}`);
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    logger.warn('security', `Blocked window.open to ${url}`);
    return { action: 'deny' as const };
  });
}

// ── Permission handlers ──

const ALLOWED_PERMISSIONS = new Set(['media']);

export function configurePermissions(logger: Logger): void {
  const prefixes = getAppOriginPrefixes();

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl =
      (details as { requestingUrl?: string }).requestingUrl ?? webContents?.getURL() ?? '';
    const granted = isAppUrl(requestingUrl, prefixes) && ALLOWED_PERMISSIONS.has(permission);

    if (!granted) {
      logger.warn('security', `Denied permission "${permission}" for ${requestingUrl}`);
    }

    callback(granted);
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return isAppUrl(requestingOrigin, prefixes) && ALLOWED_PERMISSIONS.has(permission);
  });

  logger.info('security', 'Permission handlers configured');
}
