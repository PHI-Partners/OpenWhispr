import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { findModel, WHISPER_MODELS, type WhisperModelName } from '@shared/whisperModels';
import { TMP_REAP_AGE_MS } from '../config';

export class ModelStoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ModelStoreError';
    this.code = code;
  }
}

export interface ModelInventoryEntry {
  name: WhisperModelName;
  description: string;
  expectedSizeBytes: number;
  recommended: boolean;
  installed: boolean;
  sizeOnDiskBytes: number | null;
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

const TEMP_SUFFIX = '.tmp';

export interface ReapWarning {
  file: string;
  error: unknown;
}

export class ModelStore {
  private readonly modelsDir: string;
  readonly reapWarnings: ReapWarning[] = [];

  constructor(modelsDir: string) {
    this.modelsDir = modelsDir;
  }

  resolveModelPath(name: string): string {
    const model = findModel(name);
    if (!model) {
      throw new ModelStoreError('UNKNOWN_MODEL', `Unknown whisper model "${name}"`);
    }
    return join(this.modelsDir, model.fileName);
  }

  list(): ModelInventoryEntry[] {
    return WHISPER_MODELS.map((model) => {
      const sizeOnDiskBytes = this.installedFileSize(join(this.modelsDir, model.fileName));
      return {
        name: model.name,
        description: model.description,
        expectedSizeBytes: model.expectedSizeBytes,
        recommended: model.recommended === true,
        installed: sizeOnDiskBytes !== null,
        sizeOnDiskBytes,
      };
    });
  }

  remove(name: string): boolean {
    const filePath = this.resolveModelPath(name);
    try {
      unlinkSync(filePath);
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  removeAll(): number {
    let removed = 0;
    for (const model of WHISPER_MODELS) {
      try {
        unlinkSync(join(this.modelsDir, model.fileName));
        removed += 1;
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }
    return removed;
  }

  reapStaleTemp(): string[] {
    const reaped: string[] = [];
    const cutoff = Date.now() - TMP_REAP_AGE_MS;

    let entries: string[];
    try {
      entries = readdirSync(this.modelsDir);
    } catch {
      // A missing or unreadable models directory must not break startup.
      return reaped;
    }

    for (const entry of entries) {
      if (!entry.endsWith(TEMP_SUFFIX)) continue;
      const filePath = join(this.modelsDir, entry);
      try {
        const stats = statSync(filePath);
        if (!stats.isFile() || stats.mtimeMs >= cutoff) continue;
        unlinkSync(filePath);
        reaped.push(entry);
      } catch (error) {
        if (!isNotFound(error)) {
          // EBUSY (locked by another download) or EPERM — log but don't break startup.
          this.reapWarnings.push({ file: entry, error });
        }
      }
    }

    return reaped;
  }

  private installedFileSize(filePath: string): number | null {
    try {
      const stats = statSync(filePath);
      return stats.isFile() ? stats.size : null;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }
}
