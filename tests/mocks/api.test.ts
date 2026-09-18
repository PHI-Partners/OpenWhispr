import { beforeEach, describe, expect, it } from 'vitest';
import type { RecordingStatePayload, TranscriptUpdate } from '@shared/ipc';
import { createMockApi, type MockApiResult } from './api';

describe('createMockApi', () => {
  let mock: MockApiResult;

  beforeEach(() => {
    mock = createMockApi();
  });

  describe('default return values', () => {
    it('startMeetingRecording resolves with sessionId and captureSystemAudio', async () => {
      const result = await mock.api.startMeetingRecording();
      expect(result).toEqual({ sessionId: 'mock-session-1', captureSystemAudio: false });
    });

    it('stopMeetingRecording resolves to undefined', async () => {
      await expect(mock.api.stopMeetingRecording()).resolves.toBeUndefined();
    });

    it('listMeetings resolves to an empty array', async () => {
      await expect(mock.api.listMeetings()).resolves.toEqual([]);
    });

    it('sendAudioChunk resolves to undefined', async () => {
      await expect(mock.api.sendAudioChunk({ seq: 0, data: Buffer.from([1]) })).resolves.toBeUndefined();
    });

    it('getRecordingState resolves to idle state', async () => {
      const state = await mock.api.getRecordingState();
      expect(state).toEqual({ state: 'idle', sessionId: null });
    });

    it('getMeeting resolves to a Meeting object', async () => {
      const meeting = await mock.api.getMeeting(1);
      expect(meeting).toEqual({
        id: 1,
        title: 'Mock Meeting',
        transcript: '',
        audioPath: null,
        durationSeconds: null,
        createdAt: '2025-01-01T00:00:00.000Z',
      });
    });
  });

  describe('call tracking', () => {
    it('records arguments passed to getMeeting', async () => {
      await mock.api.getMeeting(42);
      expect(mock.api.getMeeting).toHaveBeenCalledWith(42);
    });

    it('records multiple calls', async () => {
      await mock.api.startMeetingRecording();
      await mock.api.startMeetingRecording();
      expect(mock.api.startMeetingRecording).toHaveBeenCalledTimes(2);
    });
  });

  describe('per-test overrides', () => {
    it('mockResolvedValueOnce overrides the default for one call', async () => {
      mock.api.listMeetings.mockResolvedValueOnce([
        {
          id: 10,
          title: 'Override',
          transcriptPreview: 'hello',
          createdAt: '2025-06-01T00:00:00.000Z',
          durationSeconds: 60,
        },
      ]);

      const first = await mock.api.listMeetings();
      expect(first).toHaveLength(1);
      expect(first[0].title).toBe('Override');

      const second = await mock.api.listMeetings();
      expect(second).toEqual([]);
    });
  });

  describe('transcript subscription', () => {
    const payload: TranscriptUpdate = {
      sessionId: 's1',
      seq: 0,
      text: 'hello world',
      startSec: 0,
      endSec: 5,
    };

    it('delivers emitted payloads to registered listeners', () => {
      const received: TranscriptUpdate[] = [];
      mock.api.onTranscriptUpdate((p) => received.push(p));

      mock.emitTranscriptUpdate(payload);

      expect(received).toEqual([payload]);
    });

    it('unsubscribe removes the listener', () => {
      const received: TranscriptUpdate[] = [];
      const unsub = mock.api.onTranscriptUpdate((p) => received.push(p));

      unsub();
      mock.emitTranscriptUpdate(payload);

      expect(received).toEqual([]);
    });

    it('multiple listeners all receive the same emit', () => {
      const a: TranscriptUpdate[] = [];
      const b: TranscriptUpdate[] = [];
      mock.api.onTranscriptUpdate((p) => a.push(p));
      mock.api.onTranscriptUpdate((p) => b.push(p));

      mock.emitTranscriptUpdate(payload);

      expect(a).toEqual([payload]);
      expect(b).toEqual([payload]);
    });
  });

  describe('recording state subscription', () => {
    const statePayload: RecordingStatePayload = { state: 'recording', sessionId: 'sess-1' };

    it('delivers emitted state to registered listeners', () => {
      const received: RecordingStatePayload[] = [];
      mock.api.onRecordingStateChanged((p) => received.push(p));

      mock.emitRecordingStateChanged(statePayload);
      expect(received).toEqual([statePayload]);
    });

    it('unsubscribe removes the listener', () => {
      const received: RecordingStatePayload[] = [];
      const unsub = mock.api.onRecordingStateChanged((p) => received.push(p));

      unsub();
      mock.emitRecordingStateChanged(statePayload);
      expect(received).toEqual([]);
    });
  });

  describe('reset', () => {
    it('clears call history', async () => {
      await mock.api.startMeetingRecording();
      await mock.api.getMeeting(1);

      mock.reset();

      expect(mock.api.startMeetingRecording).not.toHaveBeenCalled();
      expect(mock.api.getMeeting).not.toHaveBeenCalled();
    });

    it('clears transcript listeners', () => {
      const received: TranscriptUpdate[] = [];
      mock.api.onTranscriptUpdate((p) => received.push(p));

      mock.reset();
      mock.emitTranscriptUpdate({
        sessionId: 's1',
        seq: 0,
        text: 'after reset',
        startSec: 0,
        endSec: 1,
      });

      expect(received).toEqual([]);
    });

    it('preserves default implementations after reset', async () => {
      mock.reset();
      const result = await mock.api.startMeetingRecording();
      expect(result.sessionId).toBe('mock-session-1');
    });
  });
});
