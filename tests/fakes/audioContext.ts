import { FakeMediaStream } from './media';

// ── AudioGraphRecord ──

export interface AudioGraphRecord {
  from: FakeAudioNode;
  to: FakeAudioNode;
}

// ── FakeAudioNode (base) ──

export class FakeAudioNode {
  readonly type: string;
  readonly connections: FakeAudioNode[] = [];
  private readonly ctx: FakeAudioContext;

  constructor(type: string, ctx: FakeAudioContext) {
    this.type = type;
    this.ctx = ctx;
  }

  connect(destination: FakeAudioNode): FakeAudioNode {
    this.connections.push(destination);
    this.ctx.connections.push({ from: this, to: destination });
    return destination;
  }

  disconnect(): void {
    this.connections.length = 0;
  }
}

// ── Specialised nodes ──

export class FakeGainNode extends FakeAudioNode {
  override readonly type = 'GainNode' as const;
  readonly gain = { value: 1 };

  constructor(ctx: FakeAudioContext) {
    super('GainNode', ctx);
  }
}

export class FakeMediaStreamSourceNode extends FakeAudioNode {
  override readonly type = 'MediaStreamSource' as const;

  constructor(ctx: FakeAudioContext) {
    super('MediaStreamSource', ctx);
  }
}

export class FakeMediaStreamDestinationNode extends FakeAudioNode {
  override readonly type = 'MediaStreamDestination' as const;
  readonly stream: FakeMediaStream;

  constructor(ctx: FakeAudioContext) {
    super('MediaStreamDestination', ctx);
    this.stream = new FakeMediaStream();
  }
}

// ── FakeAudioContext ──

export class FakeAudioContext {
  readonly sampleRate: number;
  readonly destination: FakeAudioNode;
  state: 'running' | 'suspended' | 'closed' = 'running';

  readonly connections: AudioGraphRecord[] = [];
  readonly createdNodes: FakeAudioNode[] = [];

  constructor(options?: { sampleRate?: number }) {
    this.sampleRate = options?.sampleRate ?? 48000;
    this.destination = new FakeAudioNode('Destination', this);
  }

  createMediaStreamSource(_stream: FakeMediaStream): FakeMediaStreamSourceNode {
    const node = new FakeMediaStreamSourceNode(this);
    this.createdNodes.push(node);
    return node;
  }

  createMediaStreamDestination(): FakeMediaStreamDestinationNode {
    const node = new FakeMediaStreamDestinationNode(this);
    this.createdNodes.push(node);
    return node;
  }

  createGain(): FakeGainNode {
    const node = new FakeGainNode(this);
    this.createdNodes.push(node);
    return node;
  }

  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }
}
