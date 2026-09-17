import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';

async function createMainWindow(): Promise<void> {
  const mainWindow = new BrowserWindow({
    webPreferences: { preload: join(__dirname, '../preload/index.js') },
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
  .then(createMainWindow)
  .catch((error: unknown) => console.error('Failed to open the main window', error));
