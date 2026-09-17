import { test, expect, skipWithoutRealBinaries } from './fixtures';

test.describe('real-binary smoke', () => {
  skipWithoutRealBinaries(test);

  test('app launches with real whisper-server binary', async ({ app, mainWindow }) => {
    const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    expect(windows).toBeGreaterThanOrEqual(1);
    expect(await mainWindow.title()).toBe('Meeting Recorder');
  });
});
