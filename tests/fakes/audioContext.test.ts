import { describe, expect, it } from 'vitest';
import {
  FakeAudioContext,
  FakeGainNode,
  FakeMediaStreamDestinationNode,
  FakeMediaStreamSourceNode,
} from './audioContext';
import { FakeMediaStream, FakeMediaStreamTrack } from './media';

describe('FakeAudioContext', () => {
  it('defaults sampleRate to 48000', () => {
    const ctx = new FakeAudioContext();
    expect(ctx.sampleRate).toBe(48000);
  });

  it('accepts a custom sampleRate', () => {
    const ctx = new FakeAudioContext({ sampleRate: 16000 });
    expect(ctx.sampleRate).toBe(16000);
  });

  it('starts in running state', () => {
    const ctx = new FakeAudioContext();
    expect(ctx.state).toBe('running');
  });

  it('has a destination node', () => {
    const ctx = new FakeAudioContext();
    expect(ctx.destination).toBeDefined();
    expect(ctx.destination.type).toBe('Destination');
  });

  describe('createMediaStreamSource', () => {
    it('creates a source node and records it', () => {
      const ctx = new FakeAudioContext();
      const stream = new FakeMediaStream([new FakeMediaStreamTrack('audio')]);
      const source = ctx.createMediaStreamSource(stream);

      expect(source).toBeInstanceOf(FakeMediaStreamSourceNode);
      expect(source.type).toBe('MediaStreamSource');
      expect(ctx.createdNodes).toContain(source);
    });
  });

  describe('createMediaStreamDestination', () => {
    it('creates a destination node with a stream', () => {
      const ctx = new FakeAudioContext();
      const dest = ctx.createMediaStreamDestination();

      expect(dest).toBeInstanceOf(FakeMediaStreamDestinationNode);
      expect(dest.type).toBe('MediaStreamDestination');
      expect(dest.stream).toBeInstanceOf(FakeMediaStream);
      expect(ctx.createdNodes).toContain(dest);
    });
  });

  describe('createGain', () => {
    it('creates a gain node with gain.value = 1', () => {
      const ctx = new FakeAudioContext();
      const gain = ctx.createGain();

      expect(gain).toBeInstanceOf(FakeGainNode);
      expect(gain.type).toBe('GainNode');
      expect(gain.gain.value).toBe(1);
      expect(ctx.createdNodes).toContain(gain);
    });
  });

  describe('connect and disconnect', () => {
    it('records connections in both the node and the context', () => {
      const ctx = new FakeAudioContext();
      const stream = new FakeMediaStream([new FakeMediaStreamTrack('audio')]);
      const source = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();

      source.connect(gain);

      expect(source.connections).toEqual([gain]);
      expect(ctx.connections).toEqual([{ from: source, to: gain }]);
    });

    it('tracks a full audio graph: source → gain → destination', () => {
      const ctx = new FakeAudioContext();
      const stream = new FakeMediaStream([new FakeMediaStreamTrack('audio')]);
      const source = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();

      source.connect(gain);
      gain.connect(ctx.destination);

      expect(ctx.connections).toEqual([
        { from: source, to: gain },
        { from: gain, to: ctx.destination },
      ]);
    });

    it('connect returns the destination node for chaining', () => {
      const ctx = new FakeAudioContext();
      const gain = ctx.createGain();

      const result = gain.connect(ctx.destination);
      expect(result).toBe(ctx.destination);
    });

    it('disconnect clears the node connections', () => {
      const ctx = new FakeAudioContext();
      const gain = ctx.createGain();
      gain.connect(ctx.destination);

      gain.disconnect();

      expect(gain.connections).toEqual([]);
    });

    it('disconnect does not remove entries from the context record', () => {
      const ctx = new FakeAudioContext();
      const gain = ctx.createGain();
      gain.connect(ctx.destination);

      gain.disconnect();

      expect(ctx.connections).toHaveLength(1);
    });
  });

  describe('close', () => {
    it('transitions state to closed', async () => {
      const ctx = new FakeAudioContext();
      await ctx.close();
      expect(ctx.state).toBe('closed');
    });
  });
});
