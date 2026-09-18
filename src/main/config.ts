import { app } from 'electron';
import ffmpegPathRaw from 'ffmpeg-static';
import { join } from 'node:path';
import { accessSync, constants as fsConstants, mkdirSync } from 'node:fs';

// ── Constants ──

export const WHISPER_PORT_MIN = 8178;
export const WHISPER_PORT_MAX = 8199;
export const HEALTH_CHECK_INTERVAL_MS = 5_000;
export const SAMPLE_RATE = 16_000;
export const CHUNK_TARGET_SECONDS = 30;
export const CHUNK_TOLERANCE_SECONDS = 5;
export const DEFAULT_HOTKEY = 'Control+Alt+M';
export const DOWNLOAD_STALL_TIMEOUT_MS = 30_000;
export const RETRY_BACKOFF_CAP_MS = 30_000;
export const FREE_DISK_HEADROOM_FACTOR = 1.2;
export const TMP_REAP_AGE_MS = 24 * 60 * 60 * 1_000;

// ── Errors ──

export class ConfigError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ConfigError';
    this.code = code;
  }
}

// ── Overrides (test seams) ──

export interface Overrides {
  userDataDir: string | undefined;
  whisperServerCmd: string | undefined;
  audioHelperCmd: string | undefined;
  chunkSeconds: number;
  forceCpu: boolean;
  disableSystemAudio: boolean;
  disableUpdater: boolean;
  modelBaseUrl: string | undefined;
}

export function readOverrides(): Overrides {
  const env = process.env;

  let chunkSeconds = CHUNK_TARGET_SECONDS;
  if (env.OW_CHUNK_SECONDS) {
    const parsed = Number(env.OW_CHUNK_SECONDS);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new ConfigError(
        'INVALID_OVERRIDE',
        `OW_CHUNK_SECONDS must be a positive number, got: ${env.OW_CHUNK_SECONDS}`,
      );
    }
    chunkSeconds = parsed;
  }

  let modelBaseUrl: string | undefined;
  if (env.OW_MODEL_BASE_URL) {
    let url: URL;
    try {
      url = new URL(env.OW_MODEL_BASE_URL);
    } catch {
      throw new ConfigError(
        'INVALID_OVERRIDE',
        `OW_MODEL_BASE_URL is not a valid URL: ${env.OW_MODEL_BASE_URL}`,
      );
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new ConfigError(
        'INVALID_OVERRIDE',
        `OW_MODEL_BASE_URL must use http or https, got: ${url.protocol}`,
      );
    }
    modelBaseUrl = env.OW_MODEL_BASE_URL;
  }

  return {
    userDataDir: env.OW_USER_DATA_DIR || undefined,
    whisperServerCmd: env.OW_WHISPER_SERVER_CMD || undefined,
    audioHelperCmd: env.OW_AUDIO_HELPER_CMD || undefined,
    chunkSeconds,
    forceCpu: env.OW_FORCE_CPU === '1',
    disableSystemAudio: env.OW_DISABLE_SYSTEM_AUDIO === '1',
    disableUpdater: env.OW_DISABLE_UPDATER === '1',
    modelBaseUrl,
  };
}

// ── Path resolution ──

export interface AppPaths {
  userData: string;
  recordings: string;
  logs: string;
  models: string;
  database: string;
  settingsFile: string;
  binDir: string;
}

function hasSpacesOrNonAscii(p: string): boolean {
  return p.includes(' ') || /[-￿]/.test(p);
}

function isUsableDir(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveModelsDir(userData: string): string {
  const candidates: string[] = [join(userData, 'models')];

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    candidates.push(join(localAppData, 'OpenWhispr', 'models'));
  }

  const programData = process.env.PROGRAMDATA;
  if (programData) {
    candidates.push(join(programData, 'OpenWhispr', 'models'));
  }

  for (const candidate of candidates) {
    if (!hasSpacesOrNonAscii(candidate) && isUsableDir(candidate)) {
      return candidate;
    }
  }

  throw new ConfigError(
    'MODELS_DIR_UNUSABLE',
    `No usable models directory found. whisper.cpp cannot open model files from paths ` +
      `containing spaces or non-ASCII characters. Candidates tried: ${candidates.join(', ')}`,
  );
}

export function resolveFfmpegPath(): string {
  if (!ffmpegPathRaw) {
    throw new ConfigError('FFMPEG_NOT_FOUND', 'ffmpeg-static binary not available for this platform');
  }
  return app.isPackaged
    ? ffmpegPathRaw.replace(/app\.asar(?![\\/.]unpacked)/, 'app.asar.unpacked')
    : ffmpegPathRaw;
}

export function resolveWhisperBinDir(binDir: string): string {
  return join(binDir, 'cpu');
}

export function preflightWhisperBinaries(
  binDir: string,
  whisperServerCmd: string | undefined,
): void {
  if (whisperServerCmd) return;

  const cpuDir = resolveWhisperBinDir(binDir);
  const required = [
    'whisper-server.exe',
    'whisper.dll',
    'ggml.dll',
    'ggml-base.dll',
    'msvcp140.dll',
    'vcruntime140.dll',
    'vcruntime140_1.dll',
    'vcomp140.dll',
  ];
  const missing = required.filter((f) => {
    try {
      accessSync(join(cpuDir, f), fsConstants.R_OK);
      return false;
    } catch {
      return true;
    }
  });
  if (missing.length > 0) {
    throw new ConfigError(
      'WHISPER_BINARIES_MISSING',
      `Missing whisper binaries in ${cpuDir}: ${missing.join(', ')}. Run "npm run setup:whisper" to provision them.`,
    );
  }
}

export function resolvePaths(): AppPaths {
  const overrides = readOverrides();
  const userData = overrides.userDataDir ?? app.getPath('userData');

  const resourceBase = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');

  return {
    userData,
    recordings: join(userData, 'recordings'),
    logs: join(userData, 'logs'),
    models: resolveModelsDir(userData),
    database: join(userData, 'openwhispr.db'),
    settingsFile: join(userData, 'settings.json'),
    binDir: join(resourceBase, 'bin'),
  };
}
