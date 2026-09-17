export async function waitFor<T>(
  fn: () => T | Promise<T>,
  opts: { timeout?: number; interval?: number } = {},
): Promise<NonNullable<T>> {
  const { timeout = 5000, interval = 50 } = opts;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`waitFor timed out after ${timeout}ms`);
}
