import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { registerIpcHandlers } from './ipc/ipcHandlers';

async function createMainWindow(): Promise<void> {
  const mainWindow = new BrowserWindow({
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // The main window hosts audio capture, which must not be throttled while hidden.
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
}

app
  .whenReady()
  .then(async () => {
    registerIpcHandlers({});
    await createMainWindow();
  })
  .catch((error: unknown) => console.error('Failed to start the app', error));
