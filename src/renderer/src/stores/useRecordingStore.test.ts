import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FakeMediaRecorder, installFakeMediaDevices, type InstalledMediaDevices } from '../../../../tests/fakes/media';
import { createMockApi, type MockApiResult } from '../../../../tests/mocks/api';
import { useRecordingStore, resetRecordingStore } from './useRecordingStore';

vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

describe('useRecordingStore', () => {
  let fakeMedia: InstalledMediaDevices;
  let mockApi: MockApiResult;

  beforeEach(() => {
    vi.useFakeTimers();
    resetRecordingStore();
    mockApi = createMockApi();
    Object.defineProperty(window, 'api', { value: mockApi.api, writable: true, configurable: true });
    fakeMedia = installFakeMediaDevices();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetRecordingStore();
    fakeMedia.restore();
    if (Object.getOwnPropertyDescriptor(window, 'api')?.configurable) {
      delete (window as unknown as Record<string, unknown>).api;
    }
  });

  describe('initial state', () => {
    it('starts idle with no session, no error, zero elapsed', () => {
      const state = useRecordingStore.getState();
      expect(state.recordingState).toBe('idle');
      expect(state.sessionId).toBeNull();
      expect(state.elapsedSeconds).toBe(0);
      expect(state.error).toBeNull();
    });
  });

  describe('syncState', () => {
    it('mirrors main-process state and sessionId', () => {
      useRecordingStore.getState().syncState({ state: 'recording', sessionId: 'sess-1' });
      const state = useRecordingStore.getState();
      expect(state.recordingState).toBe('recording');
      expect(state.sessionId).toBe('sess-1');
    });

    it('starts elapsed timer on recording state', () => {
      useRecordingStore.getState().syncState({ state: 'recording', sessionId: 'sess-1' });
      vi.advanceTimersByTime(3000);
      expect(useRecordingStore.getState().elapsedSeconds).toBe(3);
    });

    it('stops elapsed timer when leaving recording state', () => {
      useRecordingStore.getState().syncState({ state: 'recording', sessionId: 'sess-1' });
      vi.advanceTimersByTime(2000);
      useRecordingStore.getState().syncState({ state: 'idle', sessionId: null });
      vi.advanceTimersByTime(5000);
      expect(useRecordingStore.getState().elapsedSeconds).toBe(2);
    });

    it('clears error on starting state', () => {
      useRecordingStore.setState({ error: { message: 'old error' } });
      useRecordingStore.getState().syncState({ state: 'starting', sessionId: 'sess-2' });
      expect(useRecordingStore.getState().error).toBeNull();
    });
  });

  describe('startRecording', () => {
    it('calls startMeetingRecording on the API', async () => {
      await useRecordingStore.getState().startRecording();
      expect(mockApi.api.startMeetingRecording).toHaveBeenCalledOnce();
    });

    it('sends chunks after timer tick', async () => {
      await useRecordingStore.getState().startRecording();
      vi.advanceTimersByTime(1000);
      await vi.advanceTimersByTimeAsync(0);
      expect(mockApi.api.sendAudioChunk).toHaveBeenCalled();
    });

    it('prevents double-start', async () => {
      await useRecordingStore.getState().startRecording();
      await useRecordingStore.getState().startRecording();
      expect(mockApi.api.startMeetingRecording).toHaveBeenCalledOnce();
    });

    it('sets error with action on NotAllowedError', async () => {
      fakeMedia.getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
      await useRecordingStore.getState().startRecording();
      const error = useRecordingStore.getState().error;
      expect(error).not.toBeNull();
      expect(error!.action?.type).toBe('open-mic-settings');
    });

    it('calls stopMeetingRecording on permission denial to clean up main state', async () => {
      fakeMedia.getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
      await useRecordingStore.getState().startRecording();
      // stopMeetingRecording called by CaptureService.start() on getUserMedia failure
      expect(mockApi.api.stopMeetingRecording).toHaveBeenCalled();
    });
  });

  describe('stopRecording', () => {
    it('calls stopMeetingRecording on the API', async () => {
      await useRecordingStore.getState().startRecording();
      vi.advanceTimersByTime(1000);
      await vi.advanceTimersByTimeAsync(0);
      await useRecordingStore.getState().stopRecording();
      expect(mockApi.api.stopMeetingRecording).toHaveBeenCalled();
    });

    it('does nothing when no recording is active', async () => {
      await useRecordingStore.getState().stopRecording();
      expect(mockApi.api.stopMeetingRecording).not.toHaveBeenCalled();
    });
  });

  describe('dismissError', () => {
    it('clears the error', () => {
      useRecordingStore.setState({ error: { message: 'test error' } });
      useRecordingStore.getState().dismissError();
      expect(useRecordingStore.getState().error).toBeNull();
    });
  });

  describe('resetRecordingStore', () => {
    it('resets to initial state', async () => {
      await useRecordingStore.getState().startRecording();
      useRecordingStore.getState().syncState({ state: 'recording', sessionId: 'sess-1' });
      vi.advanceTimersByTime(2000);

      resetRecordingStore();

      const state = useRecordingStore.getState();
      expect(state.recordingState).toBe('idle');
      expect(state.sessionId).toBeNull();
      expect(state.elapsedSeconds).toBe(0);
      expect(state.error).toBeNull();
    });

    it('stops the elapsed timer', () => {
      useRecordingStore.getState().syncState({ state: 'recording', sessionId: 'sess-1' });
      vi.advanceTimersByTime(1000);
      resetRecordingStore();
      vi.advanceTimersByTime(5000);
      expect(useRecordingStore.getState().elapsedSeconds).toBe(0);
    });
  });
});
