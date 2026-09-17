import { describe, expect, it } from 'vitest';
import { waitFor } from './waitFor';

describe('waitFor', () => {
  it('resolves immediately when fn returns truthy', async () => {
    const result = await waitFor(() => 42);
    expect(result).toBe(42);
  });

  it('polls until fn returns truthy', async () => {
    let count = 0;
    const result = await waitFor(
      () => {
        count++;
        return count >= 3 ? 'done' : null;
      },
      { interval: 10 },
    );
    expect(result).toBe('done');
    expect(count).toBe(3);
  });

  it('works with async fn', async () => {
    let count = 0;
    const result = await waitFor(
      () => {
        count++;
        return Promise.resolve(count >= 2 ? 'async-done' : null);
      },
      { interval: 10 },
    );
    expect(result).toBe('async-done');
  });

  it('throws on timeout', async () => {
    await expect(waitFor(() => false, { timeout: 100, interval: 20 })).rejects.toThrow(
      'waitFor timed out after 100ms',
    );
  });

  it('uses default timeout and interval', async () => {
    const start = Date.now();
    const result = await waitFor(() => true);
    expect(result).toBe(true);
    expect(Date.now() - start).toBeLessThan(200);
  });
});
