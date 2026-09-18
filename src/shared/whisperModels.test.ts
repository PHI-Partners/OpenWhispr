import { describe, expect, it } from 'vitest';
import whisperModelsJson from './whisperModels.json';
import {
  findModel,
  isMultilingual,
  parseWhisperModels,
  WHISPER_MODELS,
  WHISPER_MODEL_NAMES,
} from './whisperModels';

const VALID_ENTRY = {
  name: 'tiny',
  description: 'Tiny',
  fileName: 'ggml-tiny.bin',
  expectedSizeBytes: 1234,
  sha256: 'a'.repeat(64),
};

describe('whisper model catalog', () => {
  it('guards the JSON cast at runtime', () => {
    expect(() => parseWhisperModels(whisperModelsJson)).not.toThrow();
    expect(parseWhisperModels(whisperModelsJson)).toEqual(WHISPER_MODELS);
  });

  it('loads ten entries with unique names in catalog order', () => {
    expect(WHISPER_MODELS).toHaveLength(10);
    const names = WHISPER_MODELS.map((model) => model.name);
    expect(names).toEqual([...WHISPER_MODEL_NAMES]);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(WHISPER_MODEL_NAMES).toContain(name);
    }
  });

  it('marks base.en as the only recommended model', () => {
    const recommended = WHISPER_MODELS.filter((model) => model.recommended === true).map(
      (model) => model.name,
    );
    expect(recommended).toEqual(['base.en']);
  });

  it('exposes every field with the expected runtime shape', () => {
    for (const model of WHISPER_MODELS) {
      expect(model.description.length).toBeGreaterThan(0);
      expect(model.fileName).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*\.bin$/);
      expect(Number.isSafeInteger(model.expectedSizeBytes)).toBe(true);
      expect(model.expectedSizeBytes).toBeGreaterThan(0);
      expect(model.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});

// ── parseWhisperModels ──

describe('parseWhisperModels', () => {
  it('returns validated copies without optional fields when they are absent', () => {
    const parsed = parseWhisperModels([VALID_ENTRY]);
    expect(parsed).toEqual([VALID_ENTRY]);
    expect(Object.keys(parsed[0])).not.toContain('recommended');
  });

  it('keeps an explicit recommended flag', () => {
    const parsed = parseWhisperModels([{ ...VALID_ENTRY, recommended: true }]);
    expect(parsed[0].recommended).toBe(true);
  });

  it('rejects values that are not arrays', () => {
    for (const value of [null, undefined, '[]', whisperModelsJson[0], {}]) {
      expect(() => parseWhisperModels(value)).toThrow(/Invalid whisper model catalog/);
    }
  });

  it('rejects an entry that is not an object', () => {
    expect(() => parseWhisperModels(['tiny'])).toThrow(/must be an object/);
    expect(() => parseWhisperModels([[]])).toThrow(/must be an object/);
  });

  it('rejects unknown and duplicate names', () => {
    expect(() => parseWhisperModels([{ ...VALID_ENTRY, name: 'huge' }])).toThrow(/unknown name/);
    expect(() => parseWhisperModels([{ ...VALID_ENTRY, name: 42 }])).toThrow(/unknown name/);
    expect(() => parseWhisperModels([VALID_ENTRY, { ...VALID_ENTRY }])).toThrow(/duplicates model/);
  });

  it('rejects an empty or non-string description', () => {
    expect(() => parseWhisperModels([{ ...VALID_ENTRY, description: '' }])).toThrow(/description/);
    expect(() => parseWhisperModels([{ ...VALID_ENTRY, description: 7 }])).toThrow(/description/);
  });

  it('rejects a fileName that is not a bare .bin name', () => {
    const fileNames = [
      '',
      'ggml-tiny',
      'sub/ggml-tiny.bin',
      '..\\ggml-tiny.bin',
      '../ggml-tiny.bin',
      'C:\\ggml-tiny.bin',
      '.ggml-tiny.bin',
    ];
    for (const fileName of fileNames) {
      expect(() => parseWhisperModels([{ ...VALID_ENTRY, fileName }])).toThrow(/fileName/);
    }
  });

  it('rejects a sha256 that is not 64 lowercase hex characters', () => {
    const hashes = ['', 'abc', 'A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64)];
    for (const sha256 of hashes) {
      expect(() => parseWhisperModels([{ ...VALID_ENTRY, sha256 }])).toThrow(/sha256/);
    }
  });

  it('rejects a non-positive or non-integer expectedSizeBytes', () => {
    for (const expectedSizeBytes of [0, -1, 1.5, Number.NaN, '1234']) {
      expect(() => parseWhisperModels([{ ...VALID_ENTRY, expectedSizeBytes }])).toThrow(/expectedSizeBytes/);
    }
  });

  it('rejects a non-boolean recommended flag', () => {
    expect(() => parseWhisperModels([{ ...VALID_ENTRY, recommended: 'yes' }])).toThrow(/recommended/);
  });
});

// ── findModel ──

describe('findModel', () => {
  it('finds every catalog entry by its exact name', () => {
    for (const model of WHISPER_MODELS) {
      expect(findModel(model.name)).toMatchObject({ name: model.name, fileName: model.fileName });
    }
  });

  it('returns undefined for case variants, file names and anything outside the catalog', () => {
    const names = [
      'Base.en',
      'BASE.EN',
      'ggml-base.en.bin',
      'unknown',
      '',
      '..\\evil',
      'C:\\evil.bin',
      '/etc/passwd',
    ];
    for (const name of names) {
      expect(findModel(name)).toBeUndefined();
    }
  });

  it('returns the catalog entry for base.en', () => {
    const model = findModel('base.en');
    expect(model?.name).toBe('base.en');
    expect(model?.fileName).toBe('ggml-base.en.bin');
  });
});

// ── isMultilingual ──

describe('isMultilingual', () => {
  it('is true for models without an .en suffix', () => {
    for (const name of ['tiny', 'base', 'small', 'medium', 'large', 'turbo'] as const) {
      expect(isMultilingual(name)).toBe(true);
    }
  });

  it('is false for the .en models', () => {
    for (const name of ['tiny.en', 'base.en', 'small.en', 'medium.en'] as const) {
      expect(isMultilingual(name)).toBe(false);
    }
  });
});
