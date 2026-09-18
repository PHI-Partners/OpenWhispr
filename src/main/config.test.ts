import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

vi.mock('electron', async () => import('../../tests/mocks/electron'));

import { app } from 'electron';
import { resetElectronMock } from '../../tests/mocks/electron';
import { makeTempDir } from '../../tests/helpers/tempDir';
import {
  WHISPER_PORT_MIN,
  WHISPER_PORT_MAX,
  HEALTH_CHECK_INTERVAL_MS,
  SAMPLE_RATE,
  CHUNK_TARGET_SECONDS,
  CHUNK_TOLERANCE_SECONDS,
  DEFAULT_HOTKEY,
  DOWNLOAD_STALL_TIMEOUT_MS,
  RETRY_BACKOFF_CAP_MS,
  FREE_DISK_HEADROOM_FACTOR,
  TMP_REAP_AGE_MS,
  readOverrides,
  resolvePaths,
  resolveFfmpegPath,
  ConfigError,
} from './config';

// ── Env cleanup ──

const OW_KEYS = [
  'OW_USER_DATA_DIR',
  'OW_WHISPER_SERVER_CMD',
  'OW_AUDIO_HELPER_CMD',
  'OW_CHUNK_SECONDS',
  'OW_FORCE_CPU',
  'OW_DISABLE_SYSTEM_AUDIO',
  'OW_DISABLE_UPDATER',
  'OW_MODEL_BASE_URL',
];
const SYS_KEYS = ['LOCALAPPDATA', 'PROGRAMDATA'];
const ALL_KEYS = [...OW_KEYS, ...SYS_KEYS];

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ALL_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  resetElectronMock();
});

afterEach(() => {
  for (const key of ALL_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  delete (process as unknown as Record<string, unknown>).resourcesPath;
});

// ── Constants ──

describe('constants', () => {
  it('exports whisper port range', () => {
    expect(WHISPER_PORT_MIN).toBe(8178);
    expect(WHISPER_PORT_MAX).toBe(8199);
  });

  it('exports timing constants', () => {
    expect(HEALTH_CHECK_INTERVAL_MS).toBe(5_000);
    expect(DOWNLOAD_STALL_TIMEOUT_MS).toBe(30_000);
    expect(RETRY_BACKOFF_CAP_MS).toBe(30_000);
    expect(TMP_REAP_AGE_MS).toBe(86_400_000);
  });

  it('exports audio constants', () => {
    expect(SAMPLE_RATE).toBe(16_000);
    expect(CHUNK_TARGET_SECONDS).toBe(30);
    expect(CHUNK_TOLERANCE_SECONDS).toBe(5);
  });

  it('exports UI and download constants', () => {
    expect(DEFAULT_HOTKEY).toBe('Control+Alt+M');
    expect(FREE_DISK_HEADROOM_FACTOR).toBe(1.2);
  });
});

// ── readOverrides ──

describe('readOverrides', () => {
  it('returns defaults when no OW_ vars are set', () => {
    const o = readOverrides();
    expect(o).toEqual({
      userDataDir: undefined,
      whisperServerCmd: undefined,
      audioHelperCmd: undefined,
      chunkSeconds: CHUNK_TARGET_SECONDS,
      forceCpu: false,
      disableSystemAudio: false,
      disableUpdater: false,
      modelBaseUrl: undefined,
    });
  });

  it('reads string overrides', () => {
    process.env.OW_USER_DATA_DIR = '/custom/data';
    process.env.OW_WHISPER_SERVER_CMD = '/custom/whisper';
    process.env.OW_AUDIO_HELPER_CMD = '/custom/helper';
    const o = readOverrides();
    expect(o.userDataDir).toBe('/custom/data');
    expect(o.whisperServerCmd).toBe('/custom/whisper');
    expect(o.audioHelperCmd).toBe('/custom/helper');
  });

  it('treats empty string overrides as undefined', () => {
    process.env.OW_USER_DATA_DIR = '';
    process.env.OW_WHISPER_SERVER_CMD = '';
    const o = readOverrides();
    expect(o.userDataDir).toBeUndefined();
    expect(o.whisperServerCmd).toBeUndefined();
  });

  it('reads boolean overrides: "1" is true', () => {
    process.env.OW_FORCE_CPU = '1';
    process.env.OW_DISABLE_SYSTEM_AUDIO = '1';
    process.env.OW_DISABLE_UPDATER = '1';
    const o = readOverrides();
    expect(o.forceCpu).toBe(true);
    expect(o.disableSystemAudio).toBe(true);
    expect(o.disableUpdater).toBe(true);
  });

  it('treats non-"1" boolean overrides as false', () => {
    process.env.OW_FORCE_CPU = 'true';
    process.env.OW_DISABLE_SYSTEM_AUDIO = 'yes';
    process.env.OW_DISABLE_UPDATER = '0';
    const o = readOverrides();
    expect(o.forceCpu).toBe(false);
    expect(o.disableSystemAudio).toBe(false);
    expect(o.disableUpdater).toBe(false);
  });

  it('parses OW_CHUNK_SECONDS as a positive number', () => {
    process.env.OW_CHUNK_SECONDS = '15';
    expect(readOverrides().chunkSeconds).toBe(15);
  });

  it('allows fractional OW_CHUNK_SECONDS', () => {
    process.env.OW_CHUNK_SECONDS = '5.5';
    expect(readOverrides().chunkSeconds).toBe(5.5);
  });

  it('rejects non-numeric OW_CHUNK_SECONDS', () => {
    process.env.OW_CHUNK_SECONDS = 'abc';
    expect(() => readOverrides()).toThrow(ConfigError);
    expect(() => readOverrides()).toThrow(/OW_CHUNK_SECONDS/);
  });

  it('rejects non-positive OW_CHUNK_SECONDS', () => {
    process.env.OW_CHUNK_SECONDS = '0';
    expect(() => readOverrides()).toThrow(ConfigError);
    process.env.OW_CHUNK_SECONDS = '-5';
    expect(() => readOverrides()).toThrow(ConfigError);
  });

  it('accepts valid http(s) OW_MODEL_BASE_URL', () => {
    process.env.OW_MODEL_BASE_URL = 'http://localhost:8080';
    expect(readOverrides().modelBaseUrl).toBe('http://localhost:8080');
    process.env.OW_MODEL_BASE_URL = 'https://example.com/models';
    expect(readOverrides().modelBaseUrl).toBe('https://example.com/models');
  });

  it('rejects non-http OW_MODEL_BASE_URL', () => {
    process.env.OW_MODEL_BASE_URL = 'ftp://example.com';
    expect(() => readOverrides()).toThrow(ConfigError);
    expect(() => readOverrides()).toThrow(/OW_MODEL_BASE_URL/);
  });

  it('rejects non-URL OW_MODEL_BASE_URL', () => {
    process.env.OW_MODEL_BASE_URL = 'not-a-url';
    expect(() => readOverrides()).toThrow(ConfigError);
  });
});

// ── resolvePaths ──

describe('resolvePaths', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    vi.mocked(app).getPath.mockImplementation((name: string) => join(tempDir, name));
    vi.mocked(app).getAppPath.mockReturnValue(tempDir);
    (app as unknown as { isPackaged: boolean }).isPackaged = false;
  });

  describe('dev mode', () => {
    it('resolves binDir from app root', () => {
      const paths = resolvePaths();
      expect(paths.binDir).toBe(join(tempDir, 'resources', 'bin'));
    });

    it('resolves user-data paths from app.getPath("userData")', () => {
      const ud = join(tempDir, 'userData');
      const paths = resolvePaths();
      expect(paths.userData).toBe(ud);
      expect(paths.recordings).toBe(join(ud, 'recordings'));
      expect(paths.logs).toBe(join(ud, 'logs'));
      expect(paths.database).toBe(join(ud, 'openwhispr.db'));
      expect(paths.settingsFile).toBe(join(ud, 'settings.json'));
    });
  });

  describe('packaged mode', () => {
    beforeEach(() => {
      (app as unknown as { isPackaged: boolean }).isPackaged = true;
      (process as unknown as Record<string, unknown>).resourcesPath = join(tempDir, 'app-resources');
    });

    it('resolves binDir from process.resourcesPath', () => {
      const paths = resolvePaths();
      expect(paths.binDir).toBe(join(tempDir, 'app-resources', 'bin'));
    });

    it('models never resolve under process.resourcesPath', () => {
      const paths = resolvePaths();
      const resourcesPath = join(tempDir, 'app-resources');
      expect(paths.models.startsWith(resourcesPath)).toBe(false);
    });
  });

  describe('OW_USER_DATA_DIR override', () => {
    it('takes precedence over app.getPath("userData")', () => {
      const customDir = join(tempDir, 'custom-data');
      process.env.OW_USER_DATA_DIR = customDir;
      const paths = resolvePaths();
      expect(paths.userData).toBe(customDir);
      expect(paths.recordings).toBe(join(customDir, 'recordings'));
      expect(paths.logs).toBe(join(customDir, 'logs'));
      expect(paths.database).toBe(join(customDir, 'openwhispr.db'));
      expect(paths.settingsFile).toBe(join(customDir, 'settings.json'));
    });
  });

  describe('model directory relocation', () => {
    it('uses <userData>/models when path has no spaces or non-ASCII', () => {
      const paths = resolvePaths();
      const expected = join(tempDir, 'userData', 'models');
      expect(paths.models).toBe(expected);
    });

    it('relocates when user-data path contains a space', () => {
      const spaceyDir = join(tempDir, 'user data');
      mkdirSync(spaceyDir, { recursive: true });
      vi.mocked(app).getPath.mockImplementation((name: string) =>
        name === 'userData' ? spaceyDir : join(tempDir, name),
      );
      const localAppData = join(tempDir, 'localappdata');
      process.env.LOCALAPPDATA = localAppData;

      const paths = resolvePaths();
      expect(paths.models).toBe(join(localAppData, 'OpenWhispr', 'models'));
      expect(paths.models.includes(' ')).toBe(false);
    });

    it('relocates when user-data path contains non-ASCII characters', () => {
      const unicodeDir = join(tempDir, 'données');
      mkdirSync(unicodeDir, { recursive: true });
      vi.mocked(app).getPath.mockImplementation((name: string) =>
        name === 'userData' ? unicodeDir : join(tempDir, name),
      );
      const localAppData = join(tempDir, 'localappdata');
      process.env.LOCALAPPDATA = localAppData;

      const paths = resolvePaths();
      expect(paths.models).toBe(join(localAppData, 'OpenWhispr', 'models'));
      expect(/[-￿]/.test(paths.models)).toBe(false);
    });

    it('falls through to PROGRAMDATA when LOCALAPPDATA also has spaces', () => {
      const spaceyDir = join(tempDir, 'user data');
      mkdirSync(spaceyDir, { recursive: true });
      vi.mocked(app).getPath.mockImplementation((name: string) =>
        name === 'userData' ? spaceyDir : join(tempDir, name),
      );
      process.env.LOCALAPPDATA = join(tempDir, 'local app data');
      const programData = join(tempDir, 'programdata');
      process.env.PROGRAMDATA = programData;

      const paths = resolvePaths();
      expect(paths.models).toBe(join(programData, 'OpenWhispr', 'models'));
    });

    it('returns the same directory on repeated calls (deterministic)', () => {
      const paths1 = resolvePaths();
      const paths2 = resolvePaths();
      expect(paths1.models).toBe(paths2.models);
    });

    it('throws MODELS_DIR_UNUSABLE when no candidate is usable', () => {
      const spaceyDir = join(tempDir, 'user data');
      mkdirSync(spaceyDir, { recursive: true });
      vi.mocked(app).getPath.mockImplementation((name: string) =>
        name === 'userData' ? spaceyDir : join(tempDir, name),
      );
      process.env.LOCALAPPDATA = join(tempDir, 'local app data');
      process.env.PROGRAMDATA = join(tempDir, 'program data');

      expect(() => resolvePaths()).toThrow(ConfigError);
      try {
        resolvePaths();
      } catch (e) {
        expect((e as ConfigError).code).toBe('MODELS_DIR_UNUSABLE');
      }
    });
  });
});

// ── resolveFfmpegPath ──

describe('resolveFfmpegPath', () => {
  it('returns the ffmpeg-static path in dev mode', () => {
    (app as unknown as { isPackaged: boolean }).isPackaged = false;
    const result = resolveFfmpegPath();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('replaces app.asar with app.asar.unpacked when packaged', () => {
    (app as unknown as { isPackaged: boolean }).isPackaged = true;
    const result = resolveFfmpegPath();
    expect(result).not.toContain('app.asar\\node_modules');
    expect(result).not.toContain('app.asar/node_modules');
    if (result.includes('app.asar')) {
      expect(result).toContain('app.asar.unpacked');
    }
  });

  it('does not double-replace an already-unpacked path', () => {
    (app as unknown as { isPackaged: boolean }).isPackaged = true;
    const result = resolveFfmpegPath();
    expect(result).not.toContain('app.asar.unpacked.unpacked');
  });
});
