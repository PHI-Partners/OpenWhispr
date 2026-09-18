import { useEffect } from 'react';
import { useRecordingStore } from '../stores/useRecordingStore';

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export function RecordControl() {
  const recordingState = useRecordingStore((s) => s.recordingState);
  const elapsedSeconds = useRecordingStore((s) => s.elapsedSeconds);
  const error = useRecordingStore((s) => s.error);
  const startRecording = useRecordingStore((s) => s.startRecording);
  const stopRecording = useRecordingStore((s) => s.stopRecording);
  const syncState = useRecordingStore((s) => s.syncState);
  const dismissError = useRecordingStore((s) => s.dismissError);

  useEffect(() => {
    return window.api.onRecordingStateChanged(syncState);
  }, [syncState]);

  const isIdle = recordingState === 'idle' || recordingState === 'error';
  const isActive = recordingState === 'recording' || recordingState === 'starting';
  const isFinalizing = recordingState === 'finalizing';

  return (
    <div>
      {isIdle && (
        <button onClick={() => void startRecording()}>Record</button>
      )}
      {(isActive || isFinalizing) && (
        <>
          <button onClick={() => void stopRecording()} disabled={isFinalizing}>
            Stop
          </button>
          <span aria-label="elapsed time">{formatElapsed(elapsedSeconds)}</span>
        </>
      )}
      {error && (
        <div role="alert">
          <p>{error.message}</p>
          {error.action && (
            <button onClick={() => void window.api.openMicSettings()}>
              {error.action.label}
            </button>
          )}
          <button onClick={dismissError}>Dismiss</button>
        </div>
      )}
    </div>
  );
}
