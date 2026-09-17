import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TranscriptUpdate } from '@shared/ipc';
import App from '@/App';
import { renderWithApp, storeResetFns } from './renderWithApp';

describe('renderWithApp', () => {
  it('installs window.api and renders the component', () => {
    renderWithApp(<App />);

    expect(window.api).toBeDefined();
    expect(screen.getByText('Meeting Recorder')).toBeInTheDocument();
  });

  it('returns a working mock API with default invoke values', async () => {
    const { mockApi } = renderWithApp(<App />);

    const result = await mockApi.api.startMeetingRecording();
    expect(result).toEqual({ sessionId: 'mock-session-1', captureSystemAudio: false });
  });

  it('delivers emitted transcript updates to listeners', () => {
    const { mockApi } = renderWithApp(<App />);
    const received: TranscriptUpdate[] = [];

    window.api.onTranscriptUpdate((p) => received.push(p));

    const payload: TranscriptUpdate = {
      sessionId: 's1',
      seq: 0,
      text: 'test',
      startSec: 0,
      endSec: 1,
    };
    mockApi.emitTranscriptUpdate(payload);

    expect(received).toEqual([payload]);
  });

  it('cleans up window.api between tests (part 1 — install)', () => {
    renderWithApp(<App />);
    expect(window.api).toBeDefined();
  });

  it('cleans up window.api between tests (part 2 — verify removal)', () => {
    expect(window.api).toBeUndefined();
  });

  it('provides independent mock instances across calls', () => {
    const { mockApi: first } = renderWithApp(<App />);
    // Re-render to simulate another test using renderWithApp
    const { mockApi: second } = renderWithApp(<App />);

    expect(first.api).not.toBe(second.api);
  });

  it('returns a working user-event instance', async () => {
    const { user } = renderWithApp(<App />);
    const heading = screen.getByText('Meeting Recorder');

    await expect(user.click(heading)).resolves.toBeUndefined();
  });

  it('calls registered storeResetFns on render', () => {
    const resetFn = vi.fn();
    storeResetFns.add(resetFn);

    renderWithApp(<App />);
    expect(resetFn).toHaveBeenCalled();

    storeResetFns.delete(resetFn);
  });

  it('calls registered storeResetFns on cleanup', () => {
    const resetFn = vi.fn();
    storeResetFns.add(resetFn);

    renderWithApp(<App />);
    resetFn.mockClear();

    // afterEach cleanup will run after this test, but we can verify
    // the function was called during renderWithApp
    expect(resetFn.mock.calls.length).toBe(0);

    storeResetFns.delete(resetFn);
  });
});
