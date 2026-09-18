import { describe, expect, it, beforeEach } from 'vitest';
import { existsSync, mkdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WHISPER_MODELS } from '@shared/whisperModels';
import { makeTempDir } from '../../../tests/helpers/tempDir';
import { ModelStore, ModelStoreError } from './modelStore';

let tempDir: string;
let store: ModelStore;

beforeEach(async () => {
  tempDir = await makeTempDir();
  store = new ModelStore(tempDir);
});

function writeModel(fileName: string, size: number): string {
  const filePath = join(tempDir, fileName);
  writeFileSync(filePath, Buffer.alloc(size, 1));
  return filePath;
}

function unknownModelError(name: string): unknown {
  try {
    store.resolveModelPath(name);
  } catch (error) {
    return error;
  }
  return undefined;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

// ── resolveModelPath ──

describe('resolveModelPath', () => {
  it('resolves every catalog name to its file inside the models directory', () => {
    for (const model of WHISPER_MODELS) {
      expect(store.resolveModelPath(model.name)).toBe(join(tempDir, model.fileName));
    }
  });

  it('rejects traversal, absolute paths, file names, unknown names and case variants', () => {
    const names = [
      '..\\ggml-base.en.bin',
      '../ggml-base.en.bin',
      '..',
      'C:\\Windows\\ggml-base.en.bin',
      '/etc/passwd',
      'Base.en',
      'base.EN',
      'ggml-base.en.bin',
      'unknown',
      '',
    ];
    for (const name of names) {
      const error = unknownModelError(name);
      expect(error).toBeInstanceOf(ModelStoreError);
      expect((error as ModelStoreError).code).toBe('UNKNOWN_MODEL');
    }
  });
});

// ── list ──

describe('list', () => {
  it('reports exactly the installed entries with their real on-disk size', () => {
    writeModel('ggml-base.en.bin', 1234);
    writeModel('ggml-small.bin', 5678);
    writeFileSync(join(tempDir, 'notes.txt'), 'notes');
    writeFileSync(join(tempDir, 'ggml-custom.bin'), 'custom');
    writeFileSync(join(tempDir, 'unrelated.bin'), 'unrelated');

    const rows = store.list();

    expect(rows).toHaveLength(WHISPER_MODELS.length);
    const installed = rows.filter((row) => row.installed);
    expect(installed.map((row) => row.name)).toEqual(['base.en', 'small']);
    expect(installed.map((row) => row.sizeOnDiskBytes)).toEqual([
      statSync(join(tempDir, 'ggml-base.en.bin')).size,
      statSync(join(tempDir, 'ggml-small.bin')).size,
    ]);
    expect(installed.map((row) => row.sizeOnDiskBytes)).toEqual([1234, 5678]);
    for (const row of rows) {
      if (row.installed) continue;
      expect(row.sizeOnDiskBytes).toBeNull();
    }
  });

  it('carries the catalog metadata and a normalised recommended flag', () => {
    const rows = store.list();
    const baseEn = rows.find((row) => row.name === 'base.en');
    expect(baseEn).toMatchObject({
      name: 'base.en',
      description: 'Base English-only — recommended starting point (142 MB)',
      expectedSizeBytes: 147_964_211,
      recommended: true,
    });
    expect(rows.filter((row) => row.recommended).map((row) => row.name)).toEqual(['base.en']);
    expect(rows.every((row) => typeof row.recommended === 'boolean')).toBe(true);
  });

  it('does not count a directory named like a model file as installed', () => {
    mkdirSync(join(tempDir, 'ggml-base.bin'));

    const row = store.list().find((entry) => entry.name === 'base');

    expect(row).toMatchObject({ installed: false, sizeOnDiskBytes: null });
  });

  it('reports every catalog entry as not installed when the models directory is missing', () => {
    const rows = new ModelStore(join(tempDir, 'missing')).list();

    expect(rows).toHaveLength(WHISPER_MODELS.length);
    expect(rows.every((row) => !row.installed && row.sizeOnDiskBytes === null)).toBe(true);
  });
});

// ── remove / removeAll ──

describe('remove', () => {
  it('deletes an installed model and reports success', () => {
    const filePath = writeModel('ggml-base.en.bin', 1234);

    expect(store.remove('base.en')).toBe(true);
    expect(existsSync(filePath)).toBe(false);
  });

  it('returns false when the catalog model is not installed', () => {
    expect(store.remove('base.en')).toBe(false);
  });

  it('rejects an unknown name without touching the directory', () => {
    const filePath = writeModel('ggml-base.en.bin', 1234);

    expect(() => store.remove('..\\ggml-base.en.bin')).toThrow(ModelStoreError);
    expect(existsSync(filePath)).toBe(true);
  });
});

describe('removeAll', () => {
  it('deletes every installed model, keeps unrelated files and returns the count', () => {
    writeModel('ggml-base.en.bin', 1234);
    writeModel('ggml-small.bin', 5678);
    const unrelated = join(tempDir, 'notes.txt');
    writeFileSync(unrelated, 'notes');

    expect(store.removeAll()).toBe(2);
    expect(store.list().every((row) => !row.installed)).toBe(true);
    expect(existsSync(unrelated)).toBe(true);
  });

  it('returns zero when nothing is installed', () => {
    expect(store.removeAll()).toBe(0);
  });
});

// ── reapStaleTemp ──

describe('reapStaleTemp', () => {
  it('reaps a temp file older than 24 hours and keeps a fresh one', () => {
    const stale = join(tempDir, 'ggml-base.bin.tmp');
    const almostStale = join(tempDir, 'ggml-base.en.bin.tmp');
    const fresh = join(tempDir, 'ggml-small.bin.tmp');
    writeFileSync(stale, 'partial');
    writeFileSync(almostStale, 'partial');
    writeFileSync(fresh, 'partial');
    const oldTime = new Date(Date.now() - DAY_MS - 60 * 60 * 1_000);
    utimesSync(stale, oldTime, oldTime);
    const almostOldTime = new Date(Date.now() - DAY_MS + 60 * 60 * 1_000);
    utimesSync(almostStale, almostOldTime, almostOldTime);

    expect(store.reapStaleTemp()).toEqual(['ggml-base.bin.tmp']);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(almostStale)).toBe(true);
    expect(existsSync(fresh)).toBe(true);
  });

  it('keeps a stale file that is not a .tmp', () => {
    const staleModel = writeModel('ggml-base.en.bin', 1234);
    const oldTime = new Date(Date.now() - DAY_MS * 2);
    utimesSync(staleModel, oldTime, oldTime);

    expect(store.reapStaleTemp()).toEqual([]);
    expect(existsSync(staleModel)).toBe(true);
  });

  it('returns an empty list when the models directory does not exist', () => {
    expect(new ModelStore(join(tempDir, 'missing')).reapStaleTemp()).toEqual([]);
  });
});
