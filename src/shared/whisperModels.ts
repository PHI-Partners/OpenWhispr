import whisperModelsJson from './whisperModels.json';

export const WHISPER_MODEL_NAMES = [
  'tiny',
  'tiny.en',
  'base',
  'base.en',
  'small',
  'small.en',
  'medium',
  'medium.en',
  'large',
  'turbo',
] as const;

export type WhisperModelName = (typeof WHISPER_MODEL_NAMES)[number];

export interface WhisperModel {
  name: WhisperModelName;
  description: string;
  fileName: string;
  expectedSizeBytes: number;
  sha256: string;
  recommended?: boolean;
}

const MODEL_NAME_SET: ReadonlySet<string> = new Set(WHISPER_MODEL_NAMES);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const BARE_BIN_FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.bin$/;

function catalogError(message: string): Error {
  return new Error(`Invalid whisper model catalog: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWhisperModelName(value: unknown): value is WhisperModelName {
  return typeof value === 'string' && MODEL_NAME_SET.has(value);
}

export function parseWhisperModels(value: unknown): readonly WhisperModel[] {
  if (!Array.isArray(value)) {
    throw catalogError('expected an array of model entries');
  }

  const entries = value as unknown[];
  const models: WhisperModel[] = [];
  const seenNames = new Set<string>();

  for (let index = 0; index < entries.length; index += 1) {
    const entry: unknown = entries[index];
    if (!isRecord(entry)) {
      throw catalogError(`entry ${index} must be an object`);
    }

    const name = entry.name;
    if (!isWhisperModelName(name)) {
      throw catalogError(`entry ${index} has unknown name ${JSON.stringify(name)}`);
    }
    if (seenNames.has(name)) {
      throw catalogError(`entry ${index} duplicates model "${name}"`);
    }
    seenNames.add(name);

    const description = entry.description;
    if (typeof description !== 'string' || description.length === 0) {
      throw catalogError(`entry ${index} ("${name}") has an invalid description`);
    }

    const fileName = entry.fileName;
    if (typeof fileName !== 'string' || !BARE_BIN_FILE_NAME_PATTERN.test(fileName)) {
      throw catalogError(`entry ${index} ("${name}") has an invalid fileName`);
    }

    const expectedSizeBytes = entry.expectedSizeBytes;
    if (
      typeof expectedSizeBytes !== 'number' ||
      !Number.isSafeInteger(expectedSizeBytes) ||
      expectedSizeBytes <= 0
    ) {
      throw catalogError(`entry ${index} ("${name}") has an invalid expectedSizeBytes`);
    }

    const sha256 = entry.sha256;
    if (typeof sha256 !== 'string' || !SHA256_PATTERN.test(sha256)) {
      throw catalogError(`entry ${index} ("${name}") has an invalid sha256`);
    }

    const recommended = entry.recommended;
    if (recommended !== undefined && typeof recommended !== 'boolean') {
      throw catalogError(`entry ${index} ("${name}") has an invalid recommended`);
    }

    models.push(
      recommended === undefined
        ? { name, description, fileName, expectedSizeBytes, sha256 }
        : { name, description, fileName, expectedSizeBytes, sha256, recommended },
    );
  }

  return models;
}

export const WHISPER_MODELS: readonly WhisperModel[] = parseWhisperModels(whisperModelsJson);

export function findModel(name: string): WhisperModel | undefined {
  return WHISPER_MODELS.find((model) => model.name === name);
}

/** Multilingual models need `--language auto`; the `.en` variants must never get it. */
export function isMultilingual(name: WhisperModelName): boolean {
  return !name.endsWith('.en');
}
