import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  FakeMediaRecorder,
  FakeMediaStream,
  installFakeMediaDevices,
  type InstalledMediaDevices,
} from '../../../../tests/fakes/media';
import { createMockApi, type MockApiResult } from '../../../../tests/mocks/api';
import { CaptureService, mapMediaError } from './captureService';
import { BrowserAudioSourceProvider } from './audioSourceProvider';

vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

describe('CaptureService', () => {
  let fakeMedia: InstalledMediaDevices;
  let mockApi: MockApiResult;
  let service: CaptureService;

  beforeEach(() => {
    vi.useFakeTimers();
    fakeMedia = installFakeMediaDevices();
    mockApi = createMockApi();
    Object.defineProperty(window, 'api', { value: mockApi.api, writable: true, configurable: true });
    service = new CaptureService(new BrowserAudioSourceProvider(), mockApi.api);
  });

  afterEach(() => {
    vi.useRealTimers();
    fakeMedia.restore();
    mockApi.reset();
    if (Object.getOwnPropertyDescriptor(window, 'api')?.configurable) {
      delete (window as unknown as Record<string, unknown>).api;
    }
  });

  describe('start', () => {
    it('calls startMeetingRecording then getUserMedia', async () => {
      await service.start();
      expect(mockApi.api.startMeetingRecording).toHaveBeenCalledOnce();
      expect(fakeMedia.getUserMedia).toHaveBeenCalledOnce();
    });

    it('creates a MediaRecorder with webm/opus mime type', async () => {
      await service.start();
      // Advance 1s for one timeslice tick + flush blob conversion
      vi.advanceTimersByTime(1000);
      await vi.advanceTimersByTimeAsync(0);
      expect(mockApi.api.sendAudioChunk).toHaveBeenCalled();
      const call = mockApi.api.sendAudioChunk.mock.calls[0];
      expect(call[0].seq).toBe(0);
      expect(call[0].data).toBeInstanceOf(Uint8Array);
    });
  });

  describe('chunk ordering', () => {
    it('sends chunks with sequential seq numbers', async () => {
      await service.start();
      // Advance 3 seconds for 3 chunks
      vi.advanceTimersByTime(1000);
      await vi.advanceTimersByTimeAsync(0); // flush microtasks
      vi.advanceTimersByTime(1000);
      await vi.advanceTimersByTimeAsync(0);
      vi.advanceTimersByTime(1000);
      await vi.advanceTimersByTimeAsync(0);

      const seqs = mockApi.api.sendAudioChunk.mock.calls.map((c) => c[0].seq);
      expect(seqs).toEqual([0, 1, 2]);
    });

    it('preserves order when blob conversion completes out of order', async () => {
      let callCount = 0;
      vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementation(() => {
        const myIndex = callCount++;
        return new Promise((resolve) => {
          const delay = myIndex === 0 ? 200 : myIndex === 1 ? 50 : 10;
          setTimeout(() => {
            resolve(new ArrayBuffer(FakeMediaRecorder.chunkData.byteLength));
          }, delay);
        });
      });

      await service.start();
      // Fire 3 dataavailable events
      vi.advanceTimersByTime(1000);
      vi.advanceTimersByTime(1000);
      vi.advanceTimersByTime(1000);
      // Let all conversion timeouts resolve
      await vi.advanceTimersByTimeAsync(300);

      const seqs = mockApi.api.sendAudioChunk.mock.calls.map((c) => c[0].seq);
      expect(seqs).toEqual([0, 1, 2]);

      vi.restoreAllMocks();
      vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    });
  });

  describe('stop', () => {
    it('calls stopMeetingRecording after all chunks are flushed', async () => {
      await service.start();
      vi.advanceTimersByTime(2000);
      await vi.advanceTimersByTimeAsync(0);

      await service.stop();

      // stopMeetingRecording must be called after the last sendAudioChunk
      const chunkCalls = mockApi.api.sendAudioChunk.mock.invocationCallOrder;
      const stopOrder = mockApi.api.stopMeetingRecording.mock.invocationCallOrder;
      expect(stopOrder[0]).toBeGreaterThan(chunkCalls[chunkCalls.length - 1]);
    });

    it('releases all tracks after stop', async () => {
      await service.start();
      vi.advanceTimersByTime(1000);
      await vi.advanceTimersByTimeAsync(0);

      // Get tracks before stop
      const stream = (await fakeMedia.getUserMedia.mock.results[0].value) as FakeMediaStream;
      const tracks = stream.getTracks();
      expect(tracks.length).toBeGreaterThan(0);

      await service.stop();

      for (const track of tracks) {
        expect(track.readyState).toBe('ended');
      }
    });

    it('sends the final chunk from recorder.stop()', async () => {
      await service.start();
      vi.advanceTimersByTime(2000);
      await vi.advanceTimersByTimeAsync(0);

      const chunksBefore = mockApi.api.sendAudioChunk.mock.calls.length;
      await service.stop();

      // recorder.stop() fires one more dataavailable
      expect(mockApi.api.sendAudioChunk.mock.calls.length).toBeGreaterThan(chunksBefore);
    });
  });

  describe('destroy', () => {
    it('releases tracks without calling stopMeetingRecording', async () => {
      await service.start();
      vi.advanceTimersByTime(1000);
      await vi.advanceTimersByTimeAsync(0);

      const stream = (await fakeMedia.getUserMedia.mock.results[0].value) as FakeMediaStream;
      const tracks = stream.getTracks();

      // Reset to check it's not called during destroy
      mockApi.api.stopMeetingRecording.mockClear();
      service.destroy();

      for (const track of tracks) {
        expect(track.readyState).toBe('ended');
      }
      expect(mockApi.api.stopMeetingRecording).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('calls stopMeetingRecording to clean up when getUserMedia is denied', async () => {
      fakeMedia.getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
      await expect(service.start()).rejects.toThrow();
      expect(mockApi.api.stopMeetingRecording).toHaveBeenCalledOnce();
    });

    it('calls stopMeetingRecording when getUserMedia finds no device', async () => {
      fakeMedia.getUserMedia.mockRejectedValueOnce(new DOMException('no device', 'NotFoundError'));
      await expect(service.start()).rejects.toThrow();
      expect(mockApi.api.stopMeetingRecording).toHaveBeenCalledOnce();
    });

    it('does not leak a stream when getUserMedia fails', async () => {
      fakeMedia.getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
      await expect(service.start()).rejects.toThrow();
      // No stream was obtained, nothing to clean up
      expect(fakeMedia.getUserMedia).toHaveBeenCalledOnce();
    });
  });

  describe('empty blob handling', () => {
    it('skips empty blobs and keeps seq numbers contiguous', async () => {
      const originalData = FakeMediaRecorder.chunkData;
      await service.start();

      // First chunk: normal
      vi.advanceTimersByTime(1000);
      await vi.advanceTimersByTimeAsync(0);

      // Second chunk: empty (will be skipped)
      FakeMediaRecorder.chunkData = new Uint8Array(0);
      vi.advanceTimersByTime(1000);
      await vi.advanceTimersByTimeAsync(0);

      // Third chunk: normal again
      FakeMediaRecorder.chunkData = originalData;
      vi.advanceTimersByTime(1000);
      await vi.advanceTimersByTimeAsync(0);

      const seqs = mockApi.api.sendAudioChunk.mock.calls.map((c) => c[0].seq);
      expect(seqs).toEqual([0, 1]);

      FakeMediaRecorder.chunkData = originalData;
    });
  });
});

describe('mapMediaError', () => {
  it('maps NotAllowedError to mic settings action', () => {
    const result = mapMediaError(new DOMException('denied', 'NotAllowedError'));
    expect(result.message).toContain('denied');
    expect(result.action).toEqual({ label: 'Open Microphone Settings', type: 'open-mic-settings' });
  });

  it('maps NotFoundError without action', () => {
    const result = mapMediaError(new DOMException('no device', 'NotFoundError'));
    expect(result.message).toContain('microphone');
    expect(result.action).toBeUndefined();
  });

  it('maps generic Error to message', () => {
    const result = mapMediaError(new Error('something broke'));
    expect(result.message).toBe('something broke');
    expect(result.action).toBeUndefined();
  });

  it('maps non-Error values', () => {
    const result = mapMediaError('string error');
    expect(result.message).toBe('Failed to access the microphone.');
    expect(result.action).toBeUndefined();
  });
});
