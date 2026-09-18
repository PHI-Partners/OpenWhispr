import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { EventChannel, type RecordingStatePayload } from '@shared/ipc';
import type { Logger } from '../logger';
import type { RecordingSessionEvents, RecordingSessionOpts } from './recordingSession';
import { RecordingController, RecordingControllerError } from './recordingController';

class FakeSession extends EventEmitter<RecordingSessionEvents> {
  start = vi.fn();
  writeChunk = vi.fn();
  finalize = vi.fn<() => Promise<void>>().mockImplementation(() => {
    this.emit('completed', { audioPath: '/fake/recording.wav', durationSeconds: 5 });
    return Promise.resolve();
  });
}

let fakeSession: FakeSession;

vi.mock('./recordingSession', () => ({
  RecordingSession: class {
    constructor(_opts: RecordingSessionOpts) {
      fakeSession = new FakeSession();
      return fakeSession;
    }
  },
}));

function mockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    close: vi.fn(),
  } as unknown as Logger;
}

type BroadcastFn = (channel: string, payload: unknown) => void;

function broadcastStates(spy: MockInstance<BroadcastFn>): string[] {
  return spy.mock.calls.map((call) => (call[1] as RecordingStatePayload).state);
}

describe('RecordingController', () => {
  let controller: RecordingController;
  let broadcastSpy: MockInstance<BroadcastFn>;

  beforeEach(() => {
    vi.useFakeTimers();
    broadcastSpy = vi.fn<BroadcastFn>();
    controller = new RecordingController({
      ffmpegPath: '/fake/ffmpeg',
      recordingsDir: '/fake/recordings',
      audioTimeoutMs: 5000,
      logger: mockLogger(),
      broadcast: broadcastSpy as unknown as BroadcastFn,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('state transitions', () => {
    it('initial state is idle', () => {
      expect(controller.getState()).toEqual({ state: 'idle', sessionId: null });
    });

    it('start() transitions from idle to starting', () => {
      const result = controller.start();
      expect(result.sessionId).toBeTruthy();
      expect(result.captureSystemAudio).toBe(false);
      expect(controller.getState().state).toBe('starting');
      expect(broadcastSpy).toHaveBeenCalledWith(EventChannel.RecordingStateChanged, {
        state: 'starting',
        sessionId: result.sessionId,
      });
    });

    it('first audioChunk transitions from starting to recording', () => {
      controller.start();
      broadcastSpy.mockClear();

      controller.audioChunk(0, Buffer.from([1, 2]));
      expect(controller.getState().state).toBe('recording');
      expect(broadcastSpy).toHaveBeenCalledWith(
        EventChannel.RecordingStateChanged,
        expect.objectContaining({ state: 'recording' }),
      );
    });

    it('stop() transitions finalizing then idle on session completed', async () => {
      controller.start();
      controller.audioChunk(0, Buffer.from([1, 2]));
      broadcastSpy.mockClear();

      await controller.stop();
      expect(broadcastStates(broadcastSpy)).toEqual(['finalizing', 'idle']);
      expect(controller.getState().state).toBe('idle');
    });

    it('start() from error transitions to starting (retry)', () => {
      controller.start();
      fakeSession.emit('failed', new Error('crash'));
      expect(controller.getState().state).toBe('error');

      broadcastSpy.mockClear();
      const result = controller.start();
      expect(controller.getState().state).toBe('starting');
      expect(result.sessionId).toBeTruthy();
    });
  });

  describe('guards', () => {
    it('start() from starting throws ALREADY_RECORDING', () => {
      controller.start();
      expect(() => controller.start()).toThrow(RecordingControllerError);
      expect(() => controller.start()).toThrow(/Cannot start/);
    });

    it('start() from recording throws ALREADY_RECORDING', () => {
      controller.start();
      controller.audioChunk(0, Buffer.from([1, 2]));
      expect(() => controller.start()).toThrow(RecordingControllerError);
    });

    it('start() from finalizing throws ALREADY_RECORDING', () => {
      controller.start();
      controller.audioChunk(0, Buffer.from([1, 2]));
      fakeSession.finalize.mockImplementation(() => Promise.resolve());
      void controller.stop();
      expect(() => controller.start()).toThrow(RecordingControllerError);
    });

    it('stop() from idle throws NOT_RECORDING', () => {
      expect(() => controller.stop()).toThrow(RecordingControllerError);
      expect(() => controller.stop()).toThrow(/Cannot stop/);
    });

    it('audioChunk from idle throws NOT_RECORDING', () => {
      expect(() => controller.audioChunk(0, Buffer.from([1, 2]))).toThrow(
        RecordingControllerError,
      );
    });

    it('audioChunk from error throws NOT_RECORDING', () => {
      controller.start();
      fakeSession.emit('failed', new Error('crash'));
      expect(() => controller.audioChunk(0, Buffer.from([1, 2]))).toThrow(
        RecordingControllerError,
      );
    });
  });

  describe('audio timeout', () => {
    it('no audio in starting transitions to error', () => {
      controller.start();
      vi.advanceTimersByTime(5000);
      expect(controller.getState().state).toBe('error');
      expect(broadcastSpy).toHaveBeenCalledWith(
        EventChannel.RecordingStateChanged,
        expect.objectContaining({ state: 'error' }),
      );
    });

    it('first chunk clears the timeout', () => {
      controller.start();
      controller.audioChunk(0, Buffer.from([1, 2]));
      vi.advanceTimersByTime(10000);
      expect(controller.getState().state).toBe('recording');
    });

    it('timeout does not fire after chunk received', () => {
      controller.start();
      vi.advanceTimersByTime(3000);
      controller.audioChunk(0, Buffer.from([1, 2]));
      vi.advanceTimersByTime(5000);
      expect(controller.getState().state).toBe('recording');
    });
  });

  describe('stop flush ordering', () => {
    it('stop() awaits session finalization before resolving', async () => {
      controller.start();
      controller.audioChunk(0, Buffer.from([1, 2]));

      let finalized = false;
      fakeSession.finalize.mockImplementation(() => {
        const p = new Promise<void>((r) => setTimeout(r, 100));
        void p.then(() => {
          finalized = true;
          fakeSession.emit('completed', { audioPath: '/fake/r.wav', durationSeconds: 1 });
        });
        return p;
      });

      const stopPromise = controller.stop();
      expect(finalized).toBe(false);

      vi.advanceTimersByTime(100);
      await stopPromise;
      expect(finalized).toBe(true);
    });

    it('stop from starting produces zero-duration finalization', async () => {
      controller.start();
      broadcastSpy.mockClear();
      await controller.stop();
      expect(broadcastStates(broadcastSpy)).toEqual(['finalizing', 'idle']);
      expect(controller.getState().state).toBe('idle');
    });
  });

  describe('error scenarios', () => {
    it('session failed event transitions to error', () => {
      controller.start();
      controller.audioChunk(0, Buffer.from([1, 2]));
      broadcastSpy.mockClear();

      fakeSession.emit('failed', new Error('decoder crashed'));
      expect(controller.getState().state).toBe('error');
      expect(broadcastSpy).toHaveBeenCalledWith(
        EventChannel.RecordingStateChanged,
        expect.objectContaining({ state: 'error' }),
      );
    });

    it('stop() rejects when session fails during finalization', async () => {
      controller.start();
      controller.audioChunk(0, Buffer.from([1, 2]));

      fakeSession.finalize.mockImplementation(() => {
        fakeSession.emit('failed', new Error('ffmpeg exit 1'));
        return Promise.resolve();
      });

      await expect(controller.stop()).rejects.toThrow('ffmpeg exit 1');
      expect(controller.getState().state).toBe('error');
    });
  });

  describe('broadcast', () => {
    it('broadcasts on every state transition through full lifecycle', async () => {
      controller.start();
      controller.audioChunk(0, Buffer.from([1, 2]));
      await controller.stop();
      expect(broadcastStates(broadcastSpy)).toEqual(['starting', 'recording', 'finalizing', 'idle']);
    });

    it('broadcasts include sessionId', () => {
      const result = controller.start();
      expect(broadcastSpy.mock.calls[0][1]).toEqual({
        state: 'starting',
        sessionId: result.sessionId,
      });
    });
  });
});
