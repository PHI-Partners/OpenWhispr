import { join } from 'node:path';
import { app, BrowserWindow, shell } from 'electron';
import { Logger } from './logger';
import { RecordingController } from './audio/recordingController';
import { resolveFfmpegPath, resolvePaths } from './config';
import { ModelStore } from './whisper/modelStore';
import { registerIpcHandlers } from './ipc/ipcHandlers';
import { configureContentSecurityPolicy, configurePermissions, hardenWindow } from './security';

// ── Early logger (before app.whenReady) ──

const userData = process.env.OW_USER_DATA_DIR || app.getPath('userData');
const logger = new Logger({ logsDir: join(userData, 'logs') });

process.on('uncaughtException', (err: Error) => {
  logger.error('process', `Uncaught exception: ${err.stack ?? err.message}`);
});

process.on('unhandledRejection', (reason: unknown) => {
  const message = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  logger.error('process', `Unhandled rejection: ${message}`);
});

// ── App lifecycle ──

async function createMainWindow(): Promise<BrowserWindow> {
  const mainWindow = new BrowserWindow({
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      experimentalFeatures: false,
    },
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && rendererUrl) {
    await mainWindow.loadURL(rendererUrl);
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return mainWindow;
}

app
  .whenReady()
  .then(async () => {
    configureContentSecurityPolicy(logger);
    configurePermissions(logger);

    const broadcast = (channel: string, payload: unknown): void => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(channel, payload);
      }
    };

    const paths = resolvePaths();
    const modelStore = new ModelStore(paths.models);
    const reapedTempFiles = modelStore.reapStaleTemp();
    if (reapedTempFiles.length > 0) {
      logger.info('models', `Reaped ${reapedTempFiles.length} stale model download temp file(s)`);
    }
    for (const w of modelStore.reapWarnings) {
      const reason = w.error instanceof Error ? w.error.message : String(w.error);
      logger.warn('models', `Could not reap temp file ${w.file}: ${reason}`);
    }
    const recordingController = new RecordingController({
      ffmpegPath: resolveFfmpegPath(),
      recordingsDir: paths.recordings,
      logger,
      broadcast,
    });

    registerIpcHandlers({
      logger,
      recordingController,
      openExternal: (url: string) => shell.openExternal(url),
    });
    const mainWindow = await createMainWindow();
    hardenWindow(mainWindow, logger);
    logger.info('app', 'OpenWhispr started');
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    logger.error('app', `Failed to start: ${message}`);
  });

app.on('will-quit', () => {
  logger.close();
});
