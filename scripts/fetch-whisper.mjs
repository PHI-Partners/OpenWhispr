#!/usr/bin/env node

/**
 * Provisioning script: downloads whisper.cpp CPU binaries and optionally
 * a speech model into the developer cache.
 *
 * Run:  node scripts/fetch-whisper.mjs
 *       node scripts/fetch-whisper.mjs --model base.en
 *       node scripts/fetch-whisper.mjs --model tiny --model small.en
 *
 * Idempotent: skips files that already exist with the correct SHA-256.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Pinned whisper.cpp release ──

const WHISPER_TAG = 'b5130';
const ZIP_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_TAG}/whisper-bin-x64.zip`;
const ZIP_SHA256 = 'f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c';

// ── Pinned HuggingFace revision ──

export const HF_REVISION = '5359861c739e955e79d9a303bcbc70fb988958b1';

// ── Required binaries from the zip (name → SHA-256) ──

export const REQUIRED_BINARIES = {
  'whisper-server.exe': '74c13bcb83b944412b971886d37893611fb31846780c3a78db3847b3132306bc',
  'whisper.dll': 'b7bb4ba92bd36b8afe0c00059ca6a0f69c6767193bfb5f0761e9ed27b1087803',
  'ggml.dll': 'c6e88687d6aa0238f2e834a87958f38d2dc96075a6a7bf6fb8b9cd728a0faed2',
  'ggml-base.dll': 'a5241b52206f61c9dfd6f0f53a8ef19076f9528ead2db1e039a66d7e03817bfc',
  'ggml-cpu-alderlake.dll': '5a5b11dcd38e321b13f85c95414940db9eab1132be3da6342f03dfb1d8e51bd5',
  'ggml-cpu-cannonlake.dll': '2c858781450b52eda95c381232cc65c9e19cbf621cc7b254d8c44fdbab77791e',
  'ggml-cpu-cascadelake.dll': 'ddf49bb749b34800afcb3d6224544966a05c5d00f1d0b6565bee9f3b010dd53c',
  'ggml-cpu-haswell.dll': '6b772e094b8976e22b4c043be86a1a8deda4b50511dc803a693b652c51b24944',
  'ggml-cpu-icelake.dll': 'bbd87ea5920edc401054848071ad2ef8c96bbf8007c4e4cd0ea82ba9b9e3bd10',
  'ggml-cpu-sandybridge.dll': 'de2ad5f84c7dfa557d515b3678d6452ce0216590268b2ca79cc537fe87cf239d',
  'ggml-cpu-skylakex.dll': '9fa3f9d984ca42d568181dd345072299db2978b328800343218c2c7f000b7152',
  'ggml-cpu-sse42.dll': '740fc769ef433985dfdb24a609a42d5acf188abda52287a4d89b89b567507c19',
  'ggml-cpu-x64.dll': '43ccf32b9b70aa4c47d0a12ac2ed3c241e0045571acdad565ecd9d1f99ffc08b',
};

// ── MSVC runtime DLLs (copied from the local system) ──

const MSVC_DLLS = ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'vcomp140.dll'];

// ── Model catalog (the canonical data written to whisperModels.json) ──

export const MANIFEST = [
  {
    name: 'tiny',
    description: 'Tiny \u2014 fastest, least accurate (75 MB)',
    fileName: 'ggml-tiny.bin',
    expectedSizeBytes: 77_691_713,
    sha256: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21',
  },
  {
    name: 'tiny.en',
    description: 'Tiny English-only (75 MB)',
    fileName: 'ggml-tiny.en.bin',
    expectedSizeBytes: 77_704_715,
    sha256: '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f',
  },
  {
    name: 'base',
    description: 'Base \u2014 good balance of speed and accuracy (142 MB)',
    fileName: 'ggml-base.bin',
    expectedSizeBytes: 147_951_465,
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
  },
  {
    name: 'base.en',
    description: 'Base English-only \u2014 recommended starting point (142 MB)',
    fileName: 'ggml-base.en.bin',
    expectedSizeBytes: 147_964_211,
    sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
    recommended: true,
  },
  {
    name: 'small',
    description: 'Small \u2014 better accuracy, slower (466 MB)',
    fileName: 'ggml-small.bin',
    expectedSizeBytes: 487_601_967,
    sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b',
  },
  {
    name: 'small.en',
    description: 'Small English-only (466 MB)',
    fileName: 'ggml-small.en.bin',
    expectedSizeBytes: 487_614_201,
    sha256: 'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d',
  },
  {
    name: 'medium',
    description: 'Medium \u2014 high accuracy (1.5 GB)',
    fileName: 'ggml-medium.bin',
    expectedSizeBytes: 1_533_763_059,
    sha256: '6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208',
  },
  {
    name: 'medium.en',
    description: 'Medium English-only (1.5 GB)',
    fileName: 'ggml-medium.en.bin',
    expectedSizeBytes: 1_533_774_781,
    sha256: 'cc37e93478338ec7700281a7ac30a10128929eb8f427dda2e865faa8f6da4356',
  },
  {
    name: 'large',
    description: 'Large v3 \u2014 highest accuracy, multilingual (2.9 GB)',
    fileName: 'ggml-large-v3.bin',
    expectedSizeBytes: 3_095_033_483,
    sha256: '64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2',
  },
  {
    name: 'turbo',
    description: 'Large v3 turbo \u2014 fast with near-large accuracy, multilingual (1.5 GB)',
    fileName: 'ggml-large-v3-turbo.bin',
    expectedSizeBytes: 1_624_555_275,
    sha256: '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69',
  },
];

// ── Helpers ──

/** @param {string} filePath */
export function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/**
 * @param {string} filePath
 * @param {string} expected
 * @returns {boolean}
 */
function verifyHash(filePath, expected) {
  if (!existsSync(filePath)) return false;
  return sha256(filePath) === expected;
}

// ── Manifest ──

const MANIFEST_PATH = join(ROOT, 'src', 'shared', 'whisperModels.json');

export function writeManifest() {
  const content = JSON.stringify(MANIFEST, null, 2) + '\n';
  if (existsSync(MANIFEST_PATH)) {
    const existing = readFileSync(MANIFEST_PATH, 'utf8');
    if (existing === content) {
      console.log('  whisperModels.json: up to date');
      return;
    }
  }
  writeFileSync(MANIFEST_PATH, content, 'utf8');
  console.log('  whisperModels.json: written');
}

// ── Binary provisioning ──

/**
 * @param {string} [binDir] - Override for the target directory (default: resources/bin/cpu)
 */
export async function ensureBinaries(binDir) {
  const cpuDir = binDir ?? join(ROOT, 'resources', 'bin', 'cpu');
  mkdirSync(cpuDir, { recursive: true });

  // Check if all required binaries are already present and verified
  const allPresent = Object.entries(REQUIRED_BINARIES).every(([name, hash]) =>
    verifyHash(join(cpuDir, name), hash),
  );
  if (allPresent) {
    console.log('  Whisper binaries: up to date');
  } else {
    await downloadAndExtractBinaries(cpuDir);
  }

  // MSVC runtime DLLs
  ensureMsvcDlls(cpuDir);
}

/** @param {string} cpuDir */
async function downloadAndExtractBinaries(cpuDir) {
  const tempDir = join(tmpdir(), `ow-whisper-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    const zipPath = join(tempDir, 'whisper-bin-x64.zip');

    // Download
    console.log(`  Downloading ${ZIP_URL}`);
    const res = await fetch(ZIP_URL, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} downloading whisper binaries`);
    writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));

    // Verify zip hash
    const zipHash = sha256(zipPath);
    if (zipHash !== ZIP_SHA256) {
      rmSync(zipPath, { force: true });
      throw new Error(
        `whisper-bin-x64.zip SHA-256 mismatch: expected ${ZIP_SHA256}, got ${zipHash}`,
      );
    }
    console.log('  ZIP verified');

    // Extract
    execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `Expand-Archive -Path '${zipPath}' -DestinationPath '${tempDir}' -Force`],
      { stdio: 'pipe', windowsHide: true },
    );

    // Copy and verify each required binary
    const releaseDir = join(tempDir, 'Release');
    for (const [name, expectedHash] of Object.entries(REQUIRED_BINARIES)) {
      const src = join(releaseDir, name);
      if (!existsSync(src)) {
        throw new Error(`Expected file ${name} not found in zip archive`);
      }
      const dest = join(cpuDir, name);
      copyFileSync(src, dest);

      const actualHash = sha256(dest);
      if (actualHash !== expectedHash) {
        rmSync(dest, { force: true });
        throw new Error(`${name} SHA-256 mismatch: expected ${expectedHash}, got ${actualHash}`);
      }
    }
    console.log(`  Whisper binaries: installed (${WHISPER_TAG})`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/** @param {string} cpuDir */
function ensureMsvcDlls(cpuDir) {
  const system32 = join(process.env.SYSTEMROOT ?? 'C:\\Windows', 'System32');

  for (const dll of MSVC_DLLS) {
    const dest = join(cpuDir, dll);
    if (existsSync(dest)) continue;

    const src = join(system32, dll);
    if (!existsSync(src)) {
      throw new Error(
        `${dll} not found in ${system32}. ` +
          'Install the Visual C++ Redistributable for Visual Studio 2015\u20132022 (x64): ' +
          'https://aka.ms/vs/17/release/vc_redist.x64.exe',
      );
    }
    copyFileSync(src, dest);
    console.log(`  ${dll}: copied from System32`);
  }
}

// ── Model download ──

/**
 * @param {string} name
 * @param {Array<{name: string, fileName: string, sha256: string, expectedSizeBytes: number}>} catalog
 * @param {string} cacheDir
 */
export async function downloadModel(name, catalog, cacheDir) {
  const entry = catalog.find((m) => m.name === name);
  if (!entry) {
    const valid = catalog.map((m) => m.name).join(', ');
    throw new Error(`Unknown model "${name}". Valid names: ${valid}`);
  }

  mkdirSync(cacheDir, { recursive: true });
  const dest = join(cacheDir, entry.fileName);

  if (verifyHash(dest, entry.sha256)) {
    console.log(`  Model ${name}: up to date`);
    return;
  }

  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/${HF_REVISION}/${entry.fileName}`;
  console.log(`  Downloading model ${name} (${formatBytes(entry.expectedSizeBytes)})`);
  console.log(`  ${url}`);

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading model ${name}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));

  const actualHash = sha256(dest);
  if (actualHash !== entry.sha256) {
    rmSync(dest, { force: true });
    throw new Error(
      `Model ${name} SHA-256 mismatch: expected ${entry.sha256}, got ${actualHash}`,
    );
  }
  console.log(`  Model ${name}: downloaded (SHA-256 verified)`);
}

/** @param {number} bytes */
function formatBytes(bytes) {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`;
  return `${bytes} bytes`;
}

// ── CLI ──

async function main() {
  console.log('Provisioning whisper.cpp binaries and model catalog\n');

  // Parse args
  const args = process.argv.slice(2);
  /** @type {string[]} */
  const modelNames = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model') {
      if (i + 1 >= args.length) throw new Error('--model requires a name argument');
      modelNames.push(args[++i]);
    } else {
      throw new Error(`Unknown argument: ${args[i]}`);
    }
  }
  if (modelNames.length === 0) modelNames.push('base.en');

  // 1. Write manifest
  writeManifest();

  // 2. Download/verify binaries
  await ensureBinaries();

  // 3. Download models into the developer cache
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const catalog = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const cacheDir = join(ROOT, '.cache', 'whisper-models');
  for (const name of modelNames) {
    await downloadModel(name, catalog, cacheDir);
  }

  console.log('\nDone.');
}

// Only run main() when executed directly (not imported for tests)
const isDirectRun =
  process.argv[1] &&
  (fileURLToPath(import.meta.url) === process.argv[1] ||
    fileURLToPath(import.meta.url).replace(/\\/g, '/') === process.argv[1].replace(/\\/g, '/'));
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
