import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach } from 'vitest';

const pendingCleanups: string[] = [];

afterEach(async () => {
  const dirs = pendingCleanups.splice(0);
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

export async function makeTempDir(prefix = 'ow-test-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  pendingCleanups.push(dir);
  return dir;
}
