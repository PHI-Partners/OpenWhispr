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
      'getRecordingState',
      'listMeetings',
      'logRendererError',
      'onRecordingStateChanged',
      'onTranscriptUpdate',
      'sendAudioChunk',
      'startMeetingRecording',
      'stopMeetingRecording',
    ]);
  });

  test('no console errors on startup', async ({ consoleErrors, mainWindow }) => {
    await mainWindow.waitForTimeout(1_000);
    expect(consoleErrors).toEqual([]);
  });

  test('getUserMedia resolves for audio', async ({ mainWindow }) => {
    const result = await mainWindow.evaluate(`
      (async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(t => t.stop());
          return true;
        } catch { return false; }
      })()
    `);
    expect(result).toBe(true);
  });

  test('renderer-initiated navigation to external URL is blocked', async ({ mainWindow }) => {
    const urlBefore = mainWindow.url();
    await mainWindow.evaluate(`location.href = 'https://example.com'`);
    await mainWindow.waitForTimeout(500);
    expect(mainWindow.url()).toBe(urlBefore);
  });

  test('window.open returns null', async ({ mainWindow }) => {
    const opened = await mainWindow.evaluate(`window.open('https://example.com') !== null`);
    expect(opened).toBe(false);
  });
});
