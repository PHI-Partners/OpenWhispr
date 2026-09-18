import { create } from 'zustand';
import type { RecordingState, RecordingStatePayload } from '@shared/ipc';
import { CaptureService, mapMediaError, type CaptureError } from '../services/captureService';
import { BrowserAudioSourceProvider } from '../services/audioSourceProvider';

interface RecordingStoreState {
  recordingState: RecordingState;
  sessionId: string | null;
  elapsedSeconds: number;
  error: CaptureError | null;
}

interface RecordingStoreActions {
  syncState: (payload: RecordingStatePayload) => void;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  dismissError: () => void;
}

type RecordingStore = RecordingStoreState & RecordingStoreActions;

let captureService: CaptureService | null = null;
let timerIntervalId: ReturnType<typeof setInterval> | null = null;
let timerStartTime: number | null = null;

function startElapsedTimer(set: (partial: Partial<RecordingStoreState>) => void): void {
  if (timerIntervalId !== null) return;
  timerStartTime = Date.now();
  set({ elapsedSeconds: 0 });
  timerIntervalId = setInterval(() => {
    if (timerStartTime !== null) {
      set({ elapsedSeconds: Math.floor((Date.now() - timerStartTime) / 1000) });
    }
  }, 1000);
}

function stopElapsedTimer(): void {
  if (timerIntervalId !== null) {
    clearInterval(timerIntervalId);
    timerIntervalId = null;
    timerStartTime = null;
  }
}

const initialState: RecordingStoreState = {
  recordingState: 'idle',
  sessionId: null,
  elapsedSeconds: 0,
  error: null,
};

export const useRecordingStore = create<RecordingStore>()((set) => ({
  ...initialState,

  syncState(payload: RecordingStatePayload): void {
    set({ recordingState: payload.state, sessionId: payload.sessionId });

    if (payload.state === 'recording') {
      startElapsedTimer(set);
    } else {
      stopElapsedTimer();
    }

    if (payload.state === 'starting') {
      set({ error: null });
    }
  },

  async startRecording(): Promise<void> {
    if (captureService) return;
    set({ error: null });

    const service = new CaptureService(new BrowserAudioSourceProvider(), window.api);
    captureService = service;

    try {
      await service.start();
    } catch (err) {
      service.destroy();
      captureService = null;
      set({ error: mapMediaError(err) });
    }
  },

  async stopRecording(): Promise<void> {
    if (!captureService) return;
    const service = captureService;
    captureService = null;

    try {
      await service.stop();
    } catch (err) {
      set({
        error: { message: err instanceof Error ? err.message : 'Failed to stop recording.' },
      });
    }
  },

  dismissError(): void {
    set({ error: null });
  },
}));

export function resetRecordingStore(): void {
  stopElapsedTimer();
  if (captureService) {
    captureService.destroy();
    captureService = null;
  }
  useRecordingStore.setState(initialState);
}
