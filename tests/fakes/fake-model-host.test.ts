import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  computeScriptedSha256,
  createFakeModelHost,
  type FakeModelHostInstance,
  generateScriptedBytes,
} from './fake-model-host.mjs';

describe('fake-model-host', () => {
  let host: FakeModelHostInstance;
  const TEST_LENGTH = 16 * 1024; // 16 KB

  beforeAll(async () => {
    host = await createFakeModelHost({ length: TEST_LENGTH });
  });

  afterAll(async () => {
    await host.close();
  });

  it('serves scripted bytes with correct length and SHA-256 on normal GET', async () => {
    const res = await fetch(`${host.url}/test.bin`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(TEST_LENGTH));
    expect(res.headers.get('accept-ranges')).toBe('bytes');

    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBe(TEST_LENGTH);
    expect(buf.equals(generateScriptedBytes(TEST_LENGTH))).toBe(true);
  });

  it('supports HTTP Range request returning 206 and partial slice', async () => {
    const offset = 4096;
    const res = await fetch(`${host.url}/test.bin`, {
      headers: { Range: `bytes=${offset}-` },
    });

    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes ${offset}-${TEST_LENGTH - 1}/${TEST_LENGTH}`);
    expect(res.headers.get('content-length')).toBe(String(TEST_LENGTH - offset));

    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBe(TEST_LENGTH - offset);
    expect(buf.equals(generateScriptedBytes(TEST_LENGTH).subarray(offset))).toBe(true);
  });

  it('ignores Range header when range-ignored behavior is set', async () => {
    const res = await fetch(`${host.url}/test.bin`, {
      headers: {
        Range: 'bytes=1000-',
        'x-fake-behavior': 'range-ignored',
      },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(TEST_LENGTH));
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBe(TEST_LENGTH);
  });

  it('returns 404 when 404 behavior is requested', async () => {
    const res = await fetch(`${host.url}/test.bin?behavior=404`);
    expect(res.status).toBe(404);
  });

  it('returns 500 when 500 behavior is requested', async () => {
    const res = await fetch(`${host.url}/test.bin?behavior=500`);
    expect(res.status).toBe(500);
  });

  it('returns 500 for N requests then returns 200 with 500-then-ok:<n>', async () => {
    host.setBehavior('500-then-ok:2');

    const res1 = await fetch(`${host.url}/test.bin`);
    expect(res1.status).toBe(500);

    const res2 = await fetch(`${host.url}/test.bin`);
    expect(res2.status).toBe(500);

    const res3 = await fetch(`${host.url}/test.bin`);
    expect(res3.status).toBe(200);

    host.setBehavior('normal');
  });

  it('truncates connection mid-stream when truncated:<bytes> is requested', async () => {
    await expect(
      (async () => {
        const res = await fetch(`${host.url}/test.bin?behavior=truncated:1024`);
        await res.arrayBuffer();
      })(),
    ).rejects.toThrow();
  });

  it('serves wrong content of the requested length with wrong-content behavior', async () => {
    const res = await fetch(`${host.url}/test.bin?behavior=wrong-content`);
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBe(TEST_LENGTH);

    // Byte pattern should NOT match scripted bytes
    expect(buf.equals(generateScriptedBytes(TEST_LENGTH))).toBe(false);
  });

  it('generates predictable SHA-256 with computeScriptedSha256 helper', () => {
    const hash = computeScriptedSha256(TEST_LENGTH);
    expect(typeof hash).toBe('string');
    expect(hash.length).toBe(64);
  });
});
