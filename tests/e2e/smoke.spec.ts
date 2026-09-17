import { test, expect } from './fixtures';

test.describe('smoke', () => {
  test('app launches and main window is visible', async ({ app, mainWindow }) => {
    const visible = await app.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows();
      return wins.length > 0 && wins[0].isVisible();
    });
    expect(visible).toBe(true);
    await expect(mainWindow).toHaveTitle('Meeting Recorder');
  });

  test('window.api is exposed with all methods', async ({ mainWindow }) => {
    const apiShape = await mainWindow.evaluate(() => {
      const g = globalThis as unknown as Record<string, unknown>;
      const api = g.api;
      if (!api || typeof api !== 'object') return null;
      return Object.entries(api as Record<string, unknown>)
        .filter(([, v]) => typeof v === 'function')
        .map(([k]) => k)
        .sort();
    });

    expect(apiShape).toEqual([
      'getMeeting',
      'listMeetings',
      'onTranscriptUpdate',
      'startMeetingRecording',
      'stopMeetingRecording',
    ]);
  });

  test('no console errors on startup', async ({ consoleErrors, mainWindow }) => {
    await mainWindow.waitForTimeout(1_000);
    expect(consoleErrors).toEqual([]);
  });
});
