/** Request/response channels: renderer `ipcRenderer.invoke` → main `ipcMain.handle`. */
export const InvokeChannel = {
  MeetingRecordingStart: 'meeting-recording-start',
  MeetingRecordingStop: 'meeting-recording-stop',
  DbListMeetings: 'db-list-meetings',
  DbGetMeeting: 'db-get-meeting',
} as const;
export type InvokeChannel = (typeof InvokeChannel)[keyof typeof InvokeChannel];

/** Push channels: main `webContents.send` → renderer `ipcRenderer.on`. */
export const EventChannel = {
  TranscriptUpdate: 'transcript-update',
} as const;
export type EventChannel = (typeof EventChannel)[keyof typeof EventChannel];

export interface StartMeetingRecordingResult {
  sessionId: string;
  captureSystemAudio: boolean;
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

/** Handler signature per invoke channel; a channel without an entry breaks `InvokeMethod`. */
export interface InvokeContract {
  [InvokeChannel.MeetingRecordingStart]: () => StartMeetingRecordingResult;
  [InvokeChannel.MeetingRecordingStop]: () => void;
  [InvokeChannel.DbListMeetings]: () => MeetingSummary[];
  [InvokeChannel.DbGetMeeting]: (id: number) => Meeting;
}

/** Payload per event channel; a channel without an entry breaks `SubscribeMethod`. */
export interface EventContract {
  [EventChannel.TranscriptUpdate]: TranscriptUpdate;
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
  stopMeetingRecording: InvokeMethod<typeof InvokeChannel.MeetingRecordingStop>;
  onTranscriptUpdate: SubscribeMethod<typeof EventChannel.TranscriptUpdate>;
  listMeetings: InvokeMethod<typeof InvokeChannel.DbListMeetings>;
  getMeeting: InvokeMethod<typeof InvokeChannel.DbGetMeeting>;
}
