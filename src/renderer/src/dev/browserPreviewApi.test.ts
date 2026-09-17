import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api, TranscriptUpdate } from '@shared/ipc';
import { createBrowserPreviewApi, installBrowserPreviewApi } from './browserPreviewApi';
import { RECORDING_SCRIPT, SEED_MEETINGS } from './seedData';

describe('createBrowserPreviewApi', () => {
  let api: Api;

  beforeEach(() => {
    api = createBrowserPreviewApi();
  });

  describe('listMeetings', () => {
    it('returns seeded meetings as summaries', async () => {
      const summaries = await api.listMeetings();
      expect(summaries).toHaveLength(SEED_MEETINGS.length);
      for (const s of summaries) {
        expect(s).toHaveProperty('id');
        expect(s).toHaveProperty('title');
        expect(s).toHaveProperty('createdAt');
        expect(s).toHaveProperty('transcriptPreview');
        expect(typeof s.id).toBe('number');
      }
    });

    it('returns summaries sorted newest first', async () => {
      const summaries = await api.listMeetings();
      for (let i = 1; i < summaries.length; i++) {
        expect(new Date(summaries[i - 1].createdAt).getTime()).toBeGreaterThanOrEqual(
          new Date(summaries[i].createdAt).getTime(),
        );
      }
    });
  });

  describe('getMeeting', () => {
    it('returns the correct meeting by id', async () => {
      const meeting = await api.getMeeting(1);
      expect(meeting.id).toBe(1);
      expect(meeting.title).toBe(SEED_MEETINGS[0].title);
      expect(meeting.transcript).toBe(SEED_MEETINGS[0].transcript);
    });

    it('returns a copy, not a reference', async () => {
      const a = await api.getMeeting(1);
      const b = await api.getMeeting(1);
      expect(a).toEqual(b);
      expect(a).not.toBe(b);
    });

    it('rejects for an unknown id', async () => {
      await expect(api.getMeeting(999)).rejects.toThrow('Meeting 999 not found');
    });
  });

  describe('onTranscriptUpdate', () => {
    it('delivers updates to subscribers', () => {
      const received: TranscriptUpdate[] = [];
      api.onTranscriptUpdate((payload) => received.push(payload));

      // Manually trigger via the recording simulation (tested below),
      // but we can verify the subscribe/unsubscribe contract here
      expect(received).toHaveLength(0);
    });

    it('unsubscribe stops delivery', async () => {
      vi.useFakeTimers();
      const received: TranscriptUpdate[] = [];
      const unsub = api.onTranscriptUpdate((payload) => received.push(payload));

      await api.startMeetingRecording();
      vi.advanceTimersByTime(2500);
      expect(received.length).toBeGreaterThan(0);

      const countAfterFirst = received.length;
      unsub();
      vi.advanceTimersByTime(5000);
      expect(received).toHaveLength(countAfterFirst);

      await api.stopMeetingRecording();
      vi.useRealTimers();
    });
  });

  describe('startMeetingRecording', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(async () => {
      try {
        await api.stopMeetingRecording();
      } catch {
        // not recording
      }
      vi.useRealTimers();
    });

    it('returns a session result', async () => {
      const result = await api.startMeetingRecording();
      expect(result).toHaveProperty('sessionId');
      expect(result.sessionId).toMatch(/^preview-session-/);
      expect(result.captureSystemAudio).toBe(false);
    });

    it('emits transcript updates on a schedule', async () => {
      const received: TranscriptUpdate[] = [];
      api.onTranscriptUpdate((payload) => received.push(payload));

      await api.startMeetingRecording();
      expect(received).toHaveLength(0);

      vi.advanceTimersByTime(2500);
      expect(received).toHaveLength(1);
      expect(received[0].seq).toBe(0);

      vi.advanceTimersByTime(2500);
      expect(received).toHaveLength(2);
      expect(received[1].seq).toBe(1);
    });

    it('emits all scripted updates', async () => {
      const received: TranscriptUpdate[] = [];
      api.onTranscriptUpdate((payload) => received.push(payload));

      await api.startMeetingRecording();
      vi.advanceTimersByTime(RECORDING_SCRIPT.length * 2500);

      expect(received).toHaveLength(RECORDING_SCRIPT.length);
      for (let i = 0; i < received.length; i++) {
        expect(received[i].text).toBe(RECORDING_SCRIPT[i].text);
        expect(received[i].seq).toBe(RECORDING_SCRIPT[i].seq);
      }
    });

    it('sets the sessionId on emitted updates', async () => {
      const received: TranscriptUpdate[] = [];
      api.onTranscriptUpdate((payload) => received.push(payload));

      const result = await api.startMeetingRecording();
      vi.advanceTimersByTime(2500);

      expect(received[0].sessionId).toBe(result.sessionId);
    });

    it('rejects a double start', async () => {
      await api.startMeetingRecording();
      await expect(api.startMeetingRecording()).rejects.toThrow('Recording already in progress');
    });
  });

  describe('stopMeetingRecording', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('rejects when not recording', async () => {
      await expect(api.stopMeetingRecording()).rejects.toThrow('No recording in progress');
    });

    it('adds the recorded meeting to the list', async () => {
      const before = await api.listMeetings();
      await api.startMeetingRecording();
      vi.advanceTimersByTime(5000);
      await api.stopMeetingRecording();
      const after = await api.listMeetings();

      expect(after).toHaveLength(before.length + 1);
    });

    it('builds transcript from emitted updates', async () => {
      await api.startMeetingRecording();
      vi.advanceTimersByTime(5000);
      await api.stopMeetingRecording();

      const summaries = await api.listMeetings();
      const newest = summaries[0];
      const meeting = await api.getMeeting(newest.id);
      expect(meeting.transcript).toContain(RECORDING_SCRIPT[0].text);
      expect(meeting.transcript).toContain(RECORDING_SCRIPT[1].text);
    });

    it('clears pending timers on stop', async () => {
      const received: TranscriptUpdate[] = [];
      api.onTranscriptUpdate((payload) => received.push(payload));

      await api.startMeetingRecording();
      vi.advanceTimersByTime(2500);
      const countAtStop = received.length;
      await api.stopMeetingRecording();

      vi.advanceTimersByTime(RECORDING_SCRIPT.length * 2500);
      expect(received).toHaveLength(countAtStop);
    });

    it('allows a new recording after stop', async () => {
      await api.startMeetingRecording();
      vi.advanceTimersByTime(2500);
      await api.stopMeetingRecording();

      const result = await api.startMeetingRecording();
      expect(result.sessionId).toMatch(/^preview-session-/);
      await api.stopMeetingRecording();
    });
  });
});

describe('installBrowserPreviewApi', () => {
  afterEach(() => {
    if (Object.getOwnPropertyDescriptor(window, 'api')?.configurable) {
      delete (window as unknown as Record<string, unknown>).api;
    }
  });

  it('sets window.api with all Api methods', () => {
    installBrowserPreviewApi();
    expect(window.api).toBeDefined();
    expect(typeof window.api.startMeetingRecording).toBe('function');
    expect(typeof window.api.stopMeetingRecording).toBe('function');
    expect(typeof window.api.onTranscriptUpdate).toBe('function');
    expect(typeof window.api.listMeetings).toBe('function');
    expect(typeof window.api.getMeeting).toBe('function');
  });

  it('logs installation message', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    installBrowserPreviewApi();
    expect(spy).toHaveBeenCalledWith(
      '[browser-preview] Mock API installed with %d seeded meetings',
      SEED_MEETINGS.length,
    );
    spy.mockRestore();
  });
});
