import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import { FakeMediaRecorder, installFakeMediaDevices, type InstalledMediaDevices } from '../../../../tests/fakes/media';
import { renderWithApp } from '../../../../tests/helpers/renderWithApp';
import { RecordControl } from './RecordControl';

vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

describe('RecordControl', () => {
  let fakeMedia: InstalledMediaDevices;

  beforeEach(() => {
    fakeMedia = installFakeMediaDevices();
  });

  afterEach(() => {
    fakeMedia.restore();
  });

  it('renders a Record button in idle state', () => {
    renderWithApp(<RecordControl />);
    expect(screen.getByRole('button', { name: 'Record' })).toBeInTheDocument();
  });

  it('does not show Stop button in idle state', () => {
    renderWithApp(<RecordControl />);
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
  });

  it('shows Stop button when recording state is active', async () => {
    const { mockApi, user } = renderWithApp(<RecordControl />);

    await user.click(screen.getByRole('button', { name: 'Record' }));

    // Simulate main-process state broadcast
    act(() => {
      mockApi.emitRecordingStateChanged({ state: 'recording', sessionId: 'sess-1' });
    });

    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record' })).not.toBeInTheDocument();
  });

  it('calls startMeetingRecording when Record is clicked', async () => {
    const { mockApi, user } = renderWithApp(<RecordControl />);
    await user.click(screen.getByRole('button', { name: 'Record' }));
    expect(mockApi.api.startMeetingRecording).toHaveBeenCalledOnce();
  });

  it('calls stopMeetingRecording when Stop is clicked', async () => {
    const { mockApi, user } = renderWithApp(<RecordControl />);

    await user.click(screen.getByRole('button', { name: 'Record' }));
    act(() => {
      mockApi.emitRecordingStateChanged({ state: 'recording', sessionId: 'sess-1' });
    });

    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(mockApi.api.stopMeetingRecording).toHaveBeenCalled();
  });

  it('shows elapsed time when recording', () => {
    const { mockApi } = renderWithApp(<RecordControl />);

    act(() => {
      mockApi.emitRecordingStateChanged({ state: 'recording', sessionId: 'sess-1' });
    });

    const elapsed = screen.getByLabelText('elapsed time');
    expect(elapsed).toBeInTheDocument();
    expect(elapsed.textContent).toBe('00:00');
  });

  it('disables Stop button during finalizing', () => {
    const { mockApi } = renderWithApp(<RecordControl />);

    act(() => {
      mockApi.emitRecordingStateChanged({ state: 'finalizing', sessionId: 'sess-1' });
    });

    const stopBtn = screen.getByRole('button', { name: 'Stop' });
    expect(stopBtn).toBeDisabled();
  });

  it('shows error alert with mic settings button on NotAllowedError', async () => {
    fakeMedia.getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));

    const { mockApi, user } = renderWithApp(<RecordControl />);
    await user.click(screen.getByRole('button', { name: 'Record' }));

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).toContain('denied');

    const settingsBtn = screen.getByRole('button', { name: 'Open Microphone Settings' });
    await user.click(settingsBtn);
    expect(mockApi.api.openMicSettings).toHaveBeenCalledOnce();
  });

  it('shows error alert without settings button on NotFoundError', async () => {
    fakeMedia.getUserMedia.mockRejectedValueOnce(new DOMException('no device', 'NotFoundError'));

    const { user } = renderWithApp(<RecordControl />);
    await user.click(screen.getByRole('button', { name: 'Record' }));

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Microphone Settings' })).not.toBeInTheDocument();
  });

  it('dismiss clears the error alert', async () => {
    fakeMedia.getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));

    const { user } = renderWithApp(<RecordControl />);
    await user.click(screen.getByRole('button', { name: 'Record' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('returns Record button after idle state change', () => {
    const { mockApi } = renderWithApp(<RecordControl />);

    act(() => {
      mockApi.emitRecordingStateChanged({ state: 'recording', sessionId: 'sess-1' });
    });
    expect(screen.queryByRole('button', { name: 'Record' })).not.toBeInTheDocument();

    act(() => {
      mockApi.emitRecordingStateChanged({ state: 'idle', sessionId: null });
    });
    expect(screen.getByRole('button', { name: 'Record' })).toBeInTheDocument();
  });

  it('subscribes to onRecordingStateChanged on mount', () => {
    const { mockApi } = renderWithApp(<RecordControl />);
    expect(mockApi.api.onRecordingStateChanged).toHaveBeenCalledOnce();
  });
});
