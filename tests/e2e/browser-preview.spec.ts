import { test, expect } from '@playwright/test';

// page.evaluate callbacks run in the browser, but TS checks them in Node context (no DOM).
// Cast through globalThis to access window.api, matching the pattern in smoke.spec.ts.
interface BrowserApi {
  startMeetingRecording(): Promise<{ sessionId: string; captureSystemAudio: boolean }>;
  stopMeetingRecording(): Promise<void>;
  onTranscriptUpdate(listener: (payload: unknown) => void): () => void;
  listMeetings(): Promise<Array<{ id: number; title: string; createdAt: string }>>;
  getMeeting(id: number): Promise<{
    id: number;
    title: string;
    transcript: string;
    createdAt: string;
  }>;
}

function getApi(): BrowserApi {
  const g = globalThis as unknown as Record<string, unknown>;
  return g.api as BrowserApi;
}

test.describe('browser-preview', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('mock API is installed with all methods', async ({ page }) => {
    const methods = await page.evaluate(() => {
      const g = globalThis as unknown as Record<string, unknown>;
      const api = g.api;
      if (!api || typeof api !== 'object') return null;
      return Object.entries(api as Record<string, unknown>)
        .filter(([, v]) => typeof v === 'function')
        .map(([k]) => k)
        .sort();
    });

    expect(methods).toEqual([
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

  test('seeded meetings are accessible', async ({ page }) => {
    const count = await page.evaluate(() => {
      const api = (globalThis as unknown as Record<string, unknown>).api as ReturnType<typeof getApi>;
      return api.listMeetings().then((m) => m.length);
    });
    expect(count).toBeGreaterThanOrEqual(5);
  });

  test('getMeeting returns a seeded meeting', async ({ page }) => {
    const meeting = await page.evaluate(() => {
      const api = (globalThis as unknown as Record<string, unknown>).api as ReturnType<typeof getApi>;
      return api.getMeeting(1);
    });
    expect(meeting).toHaveProperty('id', 1);
    expect(meeting).toHaveProperty('title');
    expect(meeting).toHaveProperty('transcript');
    expect(meeting).toHaveProperty('createdAt');
  });

  test('recording simulation emits transcript updates', async ({ page }) => {
    const updates = await page.evaluate(() => {
      const api = (globalThis as unknown as Record<string, unknown>).api as ReturnType<typeof getApi>;
      return new Promise<unknown[]>((resolve) => {
        const received: unknown[] = [];
        const unsub = api.onTranscriptUpdate((payload: unknown) => received.push(payload));

        void api.startMeetingRecording().then(() => {
          setTimeout(() => {
            void api.stopMeetingRecording().then(() => {
              unsub();
              resolve(received);
            });
          }, 6_000);
        });
      });
    });

    expect(updates.length).toBeGreaterThan(0);
  });

  test('stop adds a new meeting', async ({ page }) => {
    const [before, after] = await page.evaluate(() => {
      const api = (globalThis as unknown as Record<string, unknown>).api as ReturnType<typeof getApi>;
      return new Promise<[number, number]>((resolve) => {
        void api.listMeetings().then((meetingsBefore) => {
          const beforeCount = meetingsBefore.length;
          void api.startMeetingRecording().then(() => {
            setTimeout(() => {
              void api.stopMeetingRecording().then(() => {
                void api.listMeetings().then((meetingsAfter) => {
                  resolve([beforeCount, meetingsAfter.length]);
                });
              });
            }, 3_000);
          });
        });
      });
    });

    expect(after).toBe(before + 1);
  });

  test('screenshot — main screen', async ({ page }, testInfo) => {
    await page.screenshot({
      path: testInfo.outputPath(`main-${testInfo.project.name}.png`),
      fullPage: true,
    });
  });

  test('no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.reload();
    await page.waitForLoadState('networkidle');

    expect(errors).toEqual([]);
  });
});
