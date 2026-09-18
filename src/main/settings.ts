import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from './logger';

export interface Settings {
  selectedModel: string | null;
}

export const SETTINGS_DEFAULTS: Readonly<Settings> = {
  selectedModel: null,
};

export interface SettingsStoreOpts {
  filePath: string;
  logger: Logger;
}

export class SettingsStore {
  private readonly filePath: string;
  private readonly logger: Logger;

  constructor(opts: SettingsStoreOpts) {
    this.filePath = opts.filePath;
    this.logger = opts.logger;
  }

  get(): Settings {
    const raw = this.readRaw();
    return this.validateAndMerge(raw) as unknown as Settings;
  }

  set(patch: Partial<Settings>): void {
    this.validatePatch(patch);
    const raw = this.readRaw();
    const merged = { ...raw, ...patch };
    const validated = this.validateAndMerge(merged);

    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = this.filePath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(validated, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, this.filePath);
  }

  private readRaw(): Record<string, unknown> {
    let content: string;
    try {
      content = readFileSync(this.filePath, 'utf-8');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      this.quarantineCorrupt();
      return {};
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      this.quarantineCorrupt();
      return {};
    }

    return parsed as Record<string, unknown>;
  }

  private quarantineCorrupt(): void {
    const corruptPath = this.filePath + '.corrupt';
    renameSync(this.filePath, corruptPath);
    this.logger.warn('settings', `Corrupt settings file quarantined to ${corruptPath}; using defaults`);
  }

  private validateAndMerge(raw: Record<string, unknown>): Record<string, unknown> {
    const result = { ...raw };

    if (typeof result.selectedModel !== 'string' && result.selectedModel !== null) {
      result.selectedModel = SETTINGS_DEFAULTS.selectedModel;
    }

    for (const [key, defaultValue] of Object.entries(SETTINGS_DEFAULTS)) {
      if (!(key in result)) {
        result[key] = defaultValue;
      }
    }

    return result;
  }

  private validatePatch(patch: Partial<Settings>): void {
    if ('selectedModel' in patch) {
      const val = patch.selectedModel;
      if (typeof val !== 'string' && val !== null) {
        throw new TypeError(`settings: selectedModel must be a string or null, got ${typeof val}`);
      }
    }
  }
}
