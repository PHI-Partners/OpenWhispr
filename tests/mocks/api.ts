import { vi, type Mock } from 'vitest';
import type { Api, TranscriptUpdate } from '@shared/ipc';

export type MockedApi = {
  [K in keyof Api]: Mock<Api[K]>;
};

export interface MockApiResult {
  api: MockedApi;
  emitTranscriptUpdate: (payload: TranscriptUpdate) => void;
  reset: () => void;
}

export function createMockApi(): MockApiResult {
  const transcriptListeners = new Set<(payload: TranscriptUpdate) => void>();

  const api = {
    startMeetingRecording: vi.fn<Api['startMeetingRecording']>().mockResolvedValue({
      sessionId: 'mock-session-1',
      captureSystemAudio: false,
    }),

    stopMeetingRecording: vi.fn<Api['stopMeetingRecording']>().mockResolvedValue(undefined),

    listMeetings: vi.fn<Api['listMeetings']>().mockResolvedValue([]),

    getMeeting: vi.fn<Api['getMeeting']>().mockResolvedValue({
      id: 1,
      title: 'Mock Meeting',
      transcript: '',
      audioPath: null,
      durationSeconds: null,
      createdAt: '2025-01-01T00:00:00.000Z',
    }),

    onTranscriptUpdate: vi.fn<Api['onTranscriptUpdate']>().mockImplementation((listener) => {
      transcriptListeners.add(listener);
      return () => {
        transcriptListeners.delete(listener);
      };
    }),
  } satisfies Api;

  return {
    api,
    emitTranscriptUpdate(payload: TranscriptUpdate) {
      for (const listener of transcriptListeners) listener(payload);
    },
    reset() {
      transcriptListeners.clear();
      for (const fn of Object.values(api)) {
        fn.mockClear();
      }
    },
  };
}
