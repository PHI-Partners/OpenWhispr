import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from '../../tests/helpers/tempDir';
import { SettingsStore, SETTINGS_DEFAULTS } from './settings';
import type { Logger } from './logger';

function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    close: vi.fn(),
  };
}

describe('SettingsStore', () => {
  let tempDir: string;
  let filePath: string;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(async () => {
    tempDir = await makeTempDir('ow-settings-');
    filePath = join(tempDir, 'settings.json');
    mockLogger = createMockLogger();
  });

  function createStore(): SettingsStore {
    return new SettingsStore({ filePath, logger: mockLogger as unknown as Logger });
  }

  describe('get()', () => {
    it('returns defaults when file does not exist', () => {
      const store = createStore();
      expect(store.get()).toEqual(SETTINGS_DEFAULTS);
    });

    it('does not create file when reading defaults', () => {
      const store = createStore();
      store.get();
      expect(existsSync(filePath)).toBe(false);
    });

    it('reads a valid settings file', () => {
      writeFileSync(filePath, JSON.stringify({ selectedModel: 'base.en' }));
      const store = createStore();
      expect(store.get().selectedModel).toBe('base.en');
    });

    it('merges missing known keys from defaults', () => {
      writeFileSync(filePath, '{}');
      const store = createStore();
      const settings = store.get();
      expect(settings.selectedModel).toBeNull();
    });

    it('invalid value for known key falls back to default on read', () => {
      writeFileSync(filePath, JSON.stringify({ selectedModel: 42 }));
      const store = createStore();
      expect(store.get().selectedModel).toBeNull();
    });
  });

  describe('corrupt file recovery', () => {
    it('quarantines unparseable JSON and returns defaults', () => {
      writeFileSync(filePath, 'not json at all!!!');
      const store = createStore();
      const settings = store.get();

      expect(settings).toEqual(SETTINGS_DEFAULTS);
      expect(existsSync(filePath + '.corrupt')).toBe(true);
      expect(existsSync(filePath)).toBe(false);
    });

    it('quarantines non-object JSON', () => {
      writeFileSync(filePath, '[1, 2, 3]');
      const store = createStore();
      const settings = store.get();

      expect(settings).toEqual(SETTINGS_DEFAULTS);
      expect(existsSync(filePath + '.corrupt')).toBe(true);
    });

    it('quarantines null JSON', () => {
      writeFileSync(filePath, 'null');
      const store = createStore();
      expect(store.get()).toEqual(SETTINGS_DEFAULTS);
      expect(existsSync(filePath + '.corrupt')).toBe(true);
    });

    it('logs a warning when quarantining', () => {
      writeFileSync(filePath, 'broken');
      const store = createStore();
      store.get();
      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
      expect(mockLogger.warn.mock.calls[0]?.[0]).toBe('settings');
    });
  });

  describe('set()', () => {
    it('round-trip: set then get returns patched value', () => {
      const store = createStore();
      store.set({ selectedModel: 'tiny' });
      expect(store.get().selectedModel).toBe('tiny');
    });

    it('round-trip through a reopened store', () => {
      const store1 = createStore();
      store1.set({ selectedModel: 'small.en' });

      const store2 = createStore();
      expect(store2.get().selectedModel).toBe('small.en');
    });

    it('no .tmp file remains after set()', () => {
      const store = createStore();
      store.set({ selectedModel: 'base' });
      expect(existsSync(filePath + '.tmp')).toBe(false);
      expect(existsSync(filePath)).toBe(true);
    });

    it('stale .tmp from prior crash is ignored', () => {
      writeFileSync(filePath + '.tmp', 'stale partial write');
      writeFileSync(filePath, JSON.stringify({ selectedModel: 'base' }));
      const store = createStore();
      expect(store.get().selectedModel).toBe('base');
    });

    it('set() rejects invalid selectedModel type', () => {
      const store = createStore();
      expect(() => store.set({ selectedModel: 42 as unknown as string })).toThrow(TypeError);
    });

    it('allows null selectedModel', () => {
      const store = createStore();
      store.set({ selectedModel: 'base' });
      store.set({ selectedModel: null });
      expect(store.get().selectedModel).toBeNull();
    });

    it('unknown keys are preserved across set() calls', () => {
      writeFileSync(
        filePath,
        JSON.stringify({ selectedModel: null, futureKey: 'keep me', nested: { a: 1 } }),
      );
      const store = createStore();
      store.set({ selectedModel: 'base.en' });

      const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
      expect(raw.futureKey).toBe('keep me');
      expect(raw.nested).toEqual({ a: 1 });
      expect(raw.selectedModel).toBe('base.en');
    });

    it('multiple sequential set() calls produce correct final state', () => {
      const store = createStore();
      store.set({ selectedModel: 'tiny' });
      store.set({ selectedModel: 'base' });
      store.set({ selectedModel: 'large' });
      expect(store.get().selectedModel).toBe('large');
    });

    it('creates parent directory if needed', () => {
      const nestedPath = join(tempDir, 'sub', 'dir', 'settings.json');
      const store = new SettingsStore({
        filePath: nestedPath,
        logger: mockLogger as unknown as Logger,
      });
      store.set({ selectedModel: 'base' });
      expect(store.get().selectedModel).toBe('base');
    });
  });

  describe('empty patch', () => {
    it('set with empty patch preserves existing values', () => {
      const store = createStore();
      store.set({ selectedModel: 'base' });
      store.set({});
      expect(store.get().selectedModel).toBe('base');
    });
  });
});
