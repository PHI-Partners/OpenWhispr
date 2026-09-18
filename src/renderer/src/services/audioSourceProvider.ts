export interface AudioSourceProvider {
  getMicStream(): Promise<MediaStream>;
}

export class BrowserAudioSourceProvider implements AudioSourceProvider {
  async getMicStream(): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }
}
