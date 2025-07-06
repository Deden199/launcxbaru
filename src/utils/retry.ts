/**
 * Retry helper for transient errors like database write conflicts.
 *
 * @param fn - The asynchronous function to retry.
 * @param retries - Maximum number of attempts (default: 3).
 * @param delayMs - Base delay in milliseconds between retries (default: 50ms).
 * @returns The result of fn(), if successful.
 * @throws The last encountered error if all retries fail.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  retries: number = 3,
  delayMs: number = 50
): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastError = e;
      // Check for typical transient error codes/messages
      const isTransient =
        e.code === 'P2034' || // Prisma write conflict
        e.message?.toLowerCase().includes('write conflict');
      if (!isTransient || attempt === retries) {
        break;
      }
      // Exponential backoff
      const waitTime = delayMs * attempt;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
  throw lastError;
}
