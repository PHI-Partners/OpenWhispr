import { closeSync, openSync, statSync, writeSync } from 'node:fs';

const WAV_HEADER_SIZE = 44;

export interface WavWriterOpts {
  filePath: string;
  sampleRate?: number;
  channels?: number;
  bitsPerSample?: number;
}

function buildWavHeader(
  dataSize: number,
  sampleRate: number,
  channels: number,
  bitsPerSample: number,
): Buffer {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);

  const header = Buffer.alloc(WAV_HEADER_SIZE);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return header;
}

export class WavWriter {
  private readonly fd: number;
  private readonly sampleRate: number;
  private readonly channels: number;
  private readonly bitsPerSample: number;
  private dataBytes = 0;
  private closed = false;

  constructor(opts: WavWriterOpts) {
    this.sampleRate = opts.sampleRate ?? 16_000;
    this.channels = opts.channels ?? 1;
    this.bitsPerSample = opts.bitsPerSample ?? 16;

    this.fd = openSync(opts.filePath, 'w');
    writeSync(this.fd, Buffer.alloc(WAV_HEADER_SIZE));
  }

  write(pcm: Buffer): void {
    if (this.closed) throw new Error('WavWriter is closed');
    writeSync(this.fd, pcm);
    this.dataBytes += pcm.length;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const header = buildWavHeader(this.dataBytes, this.sampleRate, this.channels, this.bitsPerSample);
    writeSync(this.fd, header, 0, WAV_HEADER_SIZE, 0);
    closeSync(this.fd);
  }

  get durationSeconds(): number {
    const bytesPerSecond = this.sampleRate * this.channels * (this.bitsPerSample / 8);
    return this.dataBytes / bytesPerSecond;
  }

  get bytesWritten(): number {
    return this.dataBytes;
  }
}

export interface RepairWavHeaderOpts {
  sampleRate?: number;
  channels?: number;
  bitsPerSample?: number;
}

export function repairWavHeader(filePath: string, opts?: RepairWavHeaderOpts): void {
  const fileSize = statSync(filePath).size;
  const dataSize = fileSize - WAV_HEADER_SIZE;
  if (dataSize < 0) {
    throw new Error(`File too short to contain a WAV header (${fileSize} bytes)`);
  }

  const sampleRate = opts?.sampleRate ?? 16_000;
  const channels = opts?.channels ?? 1;
  const bitsPerSample = opts?.bitsPerSample ?? 16;

  const header = buildWavHeader(dataSize, sampleRate, channels, bitsPerSample);
  const fd = openSync(filePath, 'r+');
  try {
    writeSync(fd, header, 0, WAV_HEADER_SIZE, 0);
  } finally {
    closeSync(fd);
  }
}
