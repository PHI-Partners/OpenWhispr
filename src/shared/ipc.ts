/** Request/response channels: renderer `ipcRenderer.invoke` → main `ipcMain.handle`. */
export const InvokeChannel = {
  MeetingRecordingStart: 'meeting-recording-start',
  MeetingAudioChunk: 'meeting-audio-chunk',
  MeetingRecordingStop: 'meeting-recording-stop',
  RecordingGetState: 'recording-get-state',
  DbListMeetings: 'db-list-meetings',
  DbGetMeeting: 'db-get-meeting',
  LogRendererError: 'log-renderer-error',
  AppOpenMicSettings: 'app-open-mic-settings',
} as const;
export type InvokeChannel = (typeof InvokeChannel)[keyof typeof InvokeChannel];

/** Push channels: main `webContents.send` → renderer `ipcRenderer.on`. */
export const EventChannel = {
  TranscriptUpdate: 'transcript-update',
  RecordingStateChanged: 'recording-state-changed',
} as const;
export type EventChannel = (typeof EventChannel)[keyof typeof EventChannel];

export interface StartMeetingRecordingResult {
  sessionId: string;
  captureSystemAudio: boolean;
}

export type RecordingState = 'idle' | 'starting' | 'recording' | 'finalizing' | 'error';

export interface AudioChunkPayload {
  seq: number;
  data: Uint8Array;
}

export interface RecordingStatePayload {
  state: RecordingState;
  sessionId: string | null;
}

export interface TranscriptUpdate {
  sessionId: string;
  seq: number;
  text: string;
  startSec: number;
  endSec: number;
}

/** A row of the `meetings` table (ARCHITECTURE §4). */
export interface Meeting {
  id: number;
  title: string;
  transcript: string;
  audioPath: string | null;
  durationSeconds: number | null;
  createdAt: string;
}

export interface MeetingSummary extends Pick<Meeting, 'id' | 'title' | 'createdAt' | 'durationSeconds'> {
  transcriptPreview: string;
}

export interface RendererErrorPayload {
  message: string;
  stack: string | null;
  source: 'error' | 'unhandledrejection';
}

/** Handler signature per invoke channel; a channel without an entry breaks `InvokeMethod`. */
export interface InvokeContract {
  [InvokeChannel.MeetingRecordingStart]: () => StartMeetingRecordingResult;
  [InvokeChannel.MeetingAudioChunk]: (payload: AudioChunkPayload) => void;
  [InvokeChannel.MeetingRecordingStop]: () => void;
  [InvokeChannel.RecordingGetState]: () => RecordingStatePayload;
  [InvokeChannel.DbListMeetings]: () => MeetingSummary[];
  [InvokeChannel.DbGetMeeting]: (id: number) => Meeting;
  [InvokeChannel.LogRendererError]: (payload: RendererErrorPayload) => void;
  [InvokeChannel.AppOpenMicSettings]: () => void;
}

/** Payload per event channel; a channel without an entry breaks `SubscribeMethod`. */
export interface EventContract {
  [EventChannel.TranscriptUpdate]: TranscriptUpdate;
  [EventChannel.RecordingStateChanged]: RecordingStatePayload;
}

export type InvokeMethod<C extends InvokeChannel> = (
  ...args: Parameters<InvokeContract[C]>
) => Promise<ReturnType<InvokeContract[C]>>;

/** Registers the listener and returns the function that removes it. */
export type SubscribeMethod<C extends EventChannel> = (
  listener: (payload: EventContract[C]) => void,
) => () => void;

/** `window.api`: each method is bound to the channel named in its type. */
export interface Api {
  startMeetingRecording: InvokeMethod<typeof InvokeChannel.MeetingRecordingStart>;
  sendAudioChunk: InvokeMethod<typeof InvokeChannel.MeetingAudioChunk>;
  stopMeetingRecording: InvokeMethod<typeof InvokeChannel.MeetingRecordingStop>;
  getRecordingState: InvokeMethod<typeof InvokeChannel.RecordingGetState>;
  onRecordingStateChanged: SubscribeMethod<typeof EventChannel.RecordingStateChanged>;
  onTranscriptUpdate: SubscribeMethod<typeof EventChannel.TranscriptUpdate>;
  listMeetings: InvokeMethod<typeof InvokeChannel.DbListMeetings>;
  getMeeting: InvokeMethod<typeof InvokeChannel.DbGetMeeting>;
  logRendererError: InvokeMethod<typeof InvokeChannel.LogRendererError>;
  openMicSettings: InvokeMethod<typeof InvokeChannel.AppOpenMicSettings>;
}
