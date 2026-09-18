import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { makeTempDir } from '../tests/helpers/tempDir';
import {
  sha256,
  writeManifest,
  ensureBinaries,
  downloadModel,
  MANIFEST,
  REQUIRED_BINARIES,
  HF_REVISION,
} from './fetch-whisper.mjs';

// ── Manifest shape ──

describe('whisperModels.json manifest', () => {
  it('has exactly 10 entries', () => {
    expect(MANIFEST).toHaveLength(10);
  });

  it('has unique names', () => {
    const names = MANIFEST.map((m: { name: string }) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('has unique fileNames', () => {
    const fileNames = MANIFEST.map((m: { fileName: string }) => m.fileName);
    expect(new Set(fileNames).size).toBe(fileNames.length);
  });

  it('has exactly one recommended entry (base.en)', () => {
    const recommended = MANIFEST.filter((m: { recommended?: boolean }) => m.recommended);
    expect(recommended).toHaveLength(1);
    expect(recommended[0].name).toBe('base.en');
  });

  it('every entry has the required fields', () => {
    for (const entry of MANIFEST) {
      expect(entry).toHaveProperty('name');
      expect(entry).toHaveProperty('description');
      expect(entry).toHaveProperty('fileName');
      expect(entry).toHaveProperty('expectedSizeBytes');
      expect(entry).toHaveProperty('sha256');
      expect(typeof entry.name).toBe('string');
      expect(typeof entry.description).toBe('string');
      expect(typeof entry.fileName).toBe('string');
      expect(typeof entry.expectedSizeBytes).toBe('number');
      expect(typeof entry.sha256).toBe('string');
      expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('every implied URL uses the pinned revision', () => {
    for (const entry of MANIFEST) {
      const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/${HF_REVISION}/${entry.fileName}`;
      expect(url).toContain(HF_REVISION);
      expect(url).not.toContain('/main/');
    }
  });

  it('matches the committed JSON file', () => {
    const raw = readFileSync(join(__dirname, '..', 'src', 'shared', 'whisperModels.json'), 'utf8');
    const committed: unknown = JSON.parse(raw);
    expect(committed).toEqual(MANIFEST);
  });

  it('HF_REVISION matches the shared whisperModels constant', async () => {
    const { HF_REVISION: sharedRevision } = await import('../src/shared/whisperModels');
    expect(HF_REVISION).toBe(sharedRevision);
  });
});

// ── sha256 helper ──

describe('sha256', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  it('computes the correct hash of a known file', () => {
    const filePath = join(tempDir, 'test.bin');
    writeFileSync(filePath, 'hello world');
    expect(sha256(filePath)).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    );
  });
});

// ── writeManifest ──

describe('writeManifest', () => {
  it('is a function', () => {
    expect(typeof writeManifest).toBe('function');
  });
});

// ── ensureBinaries ──

describe('ensureBinaries', () => {
  let tempDir: string;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('attempts download when binaries are missing', async () => {
    const cpuDir = join(tempDir, 'cpu');
    mkdirSync(cpuDir, { recursive: true });

    const mockFetch = vi.fn().mockRejectedValue(new Error('Network unavailable'));
    globalThis.fetch = mockFetch;

    await expect(ensureBinaries(cpuDir)).rejects.toThrow('Network unavailable');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('attempts download when a binary has the wrong hash', async () => {
    const cpuDir = join(tempDir, 'cpu');
    mkdirSync(cpuDir, { recursive: true });

    for (const name of Object.keys(REQUIRED_BINARIES)) {
      writeFileSync(join(cpuDir, name), 'wrong content');
    }

    const mockFetch = vi.fn().mockRejectedValue(new Error('Network unavailable'));
    globalThis.fetch = mockFetch;

    await expect(ensureBinaries(cpuDir)).rejects.toThrow('Network unavailable');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('verifies 13 required binaries', () => {
    expect(Object.keys(REQUIRED_BINARIES)).toHaveLength(13);
  });

  it('never writes to resources/models/', async () => {
    const cpuDir = join(tempDir, 'cpu');
    const modelsDir = join(tempDir, 'resources', 'models');
    mkdirSync(cpuDir, { recursive: true });

    const mockFetch = vi.fn().mockRejectedValue(new Error('skip'));
    globalThis.fetch = mockFetch;

    try {
      await ensureBinaries(cpuDir);
    } catch {
      // Expected
    }

    expect(existsSync(modelsDir)).toBe(false);
  });
});

// ── downloadModel ──

describe('downloadModel', () => {
  let tempDir: string;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('rejects an unknown model name', async () => {
    await expect(downloadModel('nonexistent', MANIFEST, tempDir)).rejects.toThrow(
      /Unknown model "nonexistent"/,
    );
  });

  it('lists valid names in the error message', async () => {
    await expect(downloadModel('bogus', MANIFEST, tempDir)).rejects.toThrow(/Valid names:/);
  });

  it('does not call fetch for unknown model name', async () => {
    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    try {
      await downloadModel('nonexistent', MANIFEST, tempDir);
    } catch {
      // Expected
    }

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calls fetch when the model file does not exist', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
    globalThis.fetch = mockFetch;

    await expect(downloadModel('tiny', MANIFEST, tempDir)).rejects.toThrow(/SHA-256 mismatch/);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('deletes the file on hash mismatch', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
    globalThis.fetch = mockFetch;

    try {
      await downloadModel('tiny', MANIFEST, tempDir);
    } catch {
      // Expected
    }

    const modelPath = join(tempDir, 'ggml-tiny.bin');
    expect(existsSync(modelPath)).toBe(false);
  });

  it('skips download when model has correct hash', async () => {
    const content = Buffer.from('test-model-content');
    const hash = createHash('sha256').update(content).digest('hex');

    const fakeCatalog = [
      { name: 'test', fileName: 'ggml-test.bin', expectedSizeBytes: content.length, sha256: hash },
    ];
    writeFileSync(join(tempDir, 'ggml-test.bin'), content);

    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    await downloadModel('test', fakeCatalog, tempDir);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not write to resources/models/', async () => {
    const modelsInResources = join(tempDir, 'resources', 'models');
    const mockFetch = vi.fn().mockRejectedValue(new Error('skip'));
    globalThis.fetch = mockFetch;

    try {
      await downloadModel('tiny', MANIFEST, tempDir);
    } catch {
      // Expected
    }

    expect(existsSync(modelsInResources)).toBe(false);
  });
});
