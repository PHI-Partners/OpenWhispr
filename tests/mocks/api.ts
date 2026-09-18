import { vi, type Mock } from 'vitest';
import type { Api, RecordingStatePayload, TranscriptUpdate } from '@shared/ipc';

export type MockedApi = {
  [K in keyof Api]: Mock<Api[K]>;
};

export interface MockApiResult {
  api: MockedApi;
  emitTranscriptUpdate: (payload: TranscriptUpdate) => void;
  emitRecordingStateChanged: (payload: RecordingStatePayload) => void;
  reset: () => void;
}

export function createMockApi(): MockApiResult {
  const transcriptListeners = new Set<(payload: TranscriptUpdate) => void>();
  const recordingStateListeners = new Set<(payload: RecordingStatePayload) => void>();

  const api = {
    startMeetingRecording: vi.fn<Api['startMeetingRecording']>().mockResolvedValue({
      sessionId: 'mock-session-1',
      captureSystemAudio: false,
    }),

    sendAudioChunk: vi.fn<Api['sendAudioChunk']>().mockResolvedValue(undefined),

    stopMeetingRecording: vi.fn<Api['stopMeetingRecording']>().mockResolvedValue(undefined),

    getRecordingState: vi.fn<Api['getRecordingState']>().mockResolvedValue({
      state: 'idle',
      sessionId: null,
    }),

    onRecordingStateChanged: vi
      .fn<Api['onRecordingStateChanged']>()
      .mockImplementation((listener) => {
        recordingStateListeners.add(listener);
        return () => {
          recordingStateListeners.delete(listener);
        };
      }),

    onTranscriptUpdate: vi.fn<Api['onTranscriptUpdate']>().mockImplementation((listener) => {
      transcriptListeners.add(listener);
      return () => {
        transcriptListeners.delete(listener);
      };
    }),

    listMeetings: vi.fn<Api['listMeetings']>().mockResolvedValue([]),

    getMeeting: vi.fn<Api['getMeeting']>().mockResolvedValue({
      id: 1,
      title: 'Mock Meeting',
      transcript: '',
      audioPath: null,
      durationSeconds: null,
      createdAt: '2025-01-01T00:00:00.000Z',
    }),

    logRendererError: vi.fn<Api['logRendererError']>().mockResolvedValue(undefined),
  } satisfies Api;

  return {
    api,
    emitTranscriptUpdate(payload: TranscriptUpdate) {
      for (const listener of transcriptListeners) listener(payload);
    },
    emitRecordingStateChanged(payload: RecordingStatePayload) {
      for (const listener of recordingStateListeners) listener(payload);
    },
    reset() {
      transcriptListeners.clear();
      recordingStateListeners.clear();
      for (const fn of Object.values(api)) {
        fn.mockClear();
      }
    },
  };
}
