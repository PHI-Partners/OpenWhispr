import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { type Api, EventChannel, type EventContract, InvokeChannel, type InvokeContract } from '@shared/ipc';

function invoke<C extends InvokeChannel>(
  channel: C,
  ...args: Parameters<InvokeContract[C]>
): Promise<ReturnType<InvokeContract[C]>> {
  return ipcRenderer.invoke(channel, ...args);
}

function subscribe<C extends EventChannel>(
  channel: C,
  listener: (payload: EventContract[C]) => void,
): () => void {
  // Only the payload crosses over: the event would hand the page `event.sender`, i.e. ipcRenderer.
  const forward = (_event: IpcRendererEvent, payload: EventContract[C]): void => listener(payload);
  ipcRenderer.on(channel, forward);
  return () => {
    ipcRenderer.removeListener(channel, forward);
  };
}

const api: Api = {
  startMeetingRecording: () => invoke(InvokeChannel.MeetingRecordingStart),
  stopMeetingRecording: () => invoke(InvokeChannel.MeetingRecordingStop),
  onTranscriptUpdate: (listener) => subscribe(EventChannel.TranscriptUpdate, listener),
  listMeetings: () => invoke(InvokeChannel.DbListMeetings),
  getMeeting: (id) => invoke(InvokeChannel.DbGetMeeting, id),
  logRendererError: (payload) => invoke(InvokeChannel.LogRendererError, payload),
};

contextBridge.exposeInMainWorld('api', api);
