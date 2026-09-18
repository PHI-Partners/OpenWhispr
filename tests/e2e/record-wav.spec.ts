import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { parseWavHeader, rms } from '../helpers/audio';

test.describe('record-wav', () => {
  test('records ~3s to a playable WAV', async ({ app, mainWindow }) => {
    const recordBtn = mainWindow.getByRole('button', { name: 'Record' });
    await recordBtn.click();

    const stopBtn = mainWindow.getByRole('button', { name: 'Stop' });
    await stopBtn.waitFor({ timeout: 10_000 });

    await mainWindow.waitForTimeout(3_000);

    await stopBtn.click();

    await recordBtn.waitFor({ timeout: 15_000 });

    const userDataDir = await app.evaluate(() => process.env.OW_USER_DATA_DIR);
    expect(userDataDir).toBeTruthy();

    const recordingsDir = join(userDataDir!, 'recordings');
    const wavFiles = readdirSync(recordingsDir).filter((f) => f.endsWith('.wav'));
    expect(wavFiles).toHaveLength(1);

    const wavPath = join(recordingsDir, wavFiles[0]);
    const header = parseWavHeader(wavPath);

    expect(header.sampleRate).toBe(16_000);
    expect(header.channels).toBe(1);
    expect(header.bitsPerSample).toBe(16);
    expect(header.durationSeconds).toBeGreaterThan(1.5);
    expect(header.durationSeconds).toBeLessThan(10);

    const buf = readFileSync(wavPath);
    const pcm = new Int16Array(buf.buffer.slice(buf.byteOffset + 44, buf.byteOffset + 44 + header.dataSize));
    expect(rms(pcm)).toBeGreaterThan(100);
  });
});
