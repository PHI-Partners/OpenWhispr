import type {
  Api,
  Meeting,
  RecordingStatePayload,
  StartMeetingRecordingResult,
  TranscriptUpdate,
} from '@shared/ipc';
import { RECORDING_SCRIPT, SEED_MEETINGS, toSummaries } from './seedData';

const SCRIPT_INTERVAL_MS = 2500;

interface RecordingState {
  sessionId: string;
  timers: ReturnType<typeof setTimeout>[];
  emittedUpdates: TranscriptUpdate[];
  startTime: number;
}

export function createBrowserPreviewApi(): Api {
  const meetings: Meeting[] = SEED_MEETINGS.map((m) => ({ ...m }));
  const transcriptListeners = new Set<(payload: TranscriptUpdate) => void>();
  const recordingStateListeners = new Set<(payload: RecordingStatePayload) => void>();
  let recording: RecordingState | null = null;
  let nextId = SEED_MEETINGS.length + 1;

  function emit(payload: TranscriptUpdate): void {
    for (const listener of transcriptListeners) listener(payload);
  }

  function emitState(state: RecordingStatePayload): void {
    for (const listener of recordingStateListeners) listener(state);
  }

  const api: Api = {
    startMeetingRecording(): Promise<StartMeetingRecordingResult> {
      if (recording) {
        return Promise.reject(new Error('Recording already in progress'));
      }

      const sessionId = `preview-session-${nextId}`;
      const state: RecordingState = {
        sessionId,
        timers: [],
        emittedUpdates: [],
        startTime: Date.now(),
      };

      for (const [i, script] of RECORDING_SCRIPT.entries()) {
        const update: TranscriptUpdate = { ...script, sessionId };
        const timer = setTimeout(
          () => {
            state.emittedUpdates.push(update);
            emit(update);
          },
          (i + 1) * SCRIPT_INTERVAL_MS,
        );
        state.timers.push(timer);
      }

      recording = state;
      emitState({ state: 'recording', sessionId });
      return Promise.resolve({ sessionId, captureSystemAudio: false });
    },

    sendAudioChunk() {
      return Promise.resolve();
    },

    stopMeetingRecording(): Promise<void> {
      if (!recording) {
        return Promise.reject(new Error('No recording in progress'));
      }

      for (const timer of recording.timers) clearTimeout(timer);

      const transcript = recording.emittedUpdates.map((u) => u.text).join('\n');
      const durationSeconds = Math.round((Date.now() - recording.startTime) / 1000);
      const id = nextId++;

      meetings.push({
        id,
        title: `Recording ${new Date().toLocaleString()}`,
        transcript,
        audioPath: null,
        durationSeconds,
        createdAt: new Date().toISOString(),
      });

      recording = null;
      emitState({ state: 'idle', sessionId: null });
      return Promise.resolve();
    },

    getRecordingState(): Promise<RecordingStatePayload> {
      return Promise.resolve({
        state: recording ? 'recording' : 'idle',
        sessionId: recording?.sessionId ?? null,
      });
    },

    onRecordingStateChanged(listener: (payload: RecordingStatePayload) => void): () => void {
      recordingStateListeners.add(listener);
      return () => {
        recordingStateListeners.delete(listener);
      };
    },

    onTranscriptUpdate(listener: (payload: TranscriptUpdate) => void): () => void {
      transcriptListeners.add(listener);
      return () => {
        transcriptListeners.delete(listener);
      };
    },

    listMeetings() {
      return Promise.resolve(toSummaries(meetings));
    },

    getMeeting(id: number) {
      const meeting = meetings.find((m) => m.id === id);
      if (!meeting) {
        return Promise.reject(new Error(`Meeting ${id} not found`));
      }
      return Promise.resolve({ ...meeting });
    },

    logRendererError(payload) {
      console.warn('[browser-preview] Renderer error:', payload.source, payload.message);
      return Promise.resolve();
    },
  };

  return api;
}

export function installBrowserPreviewApi(): void {
  Object.defineProperty(window, 'api', {
    value: createBrowserPreviewApi(),
    writable: true,
    configurable: true,
  });
  console.info('[browser-preview] Mock API installed with %d seeded meetings', SEED_MEETINGS.length);
}
