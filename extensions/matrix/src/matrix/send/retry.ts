/**
 * Retry wrapper for Matrix send operations that handles M_LIMIT_EXCEEDED (429) rate limits.
 */

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_MAX_TOTAL_WAIT_MS = 30_000;
const JITTER_MAX_MS = 100;

export interface RetryOptions {
  maxRetries?: number;
  maxTotalWaitMs?: number;
  delayFn?: (ms: number) => Promise<void>;
}

export interface MatrixRateLimitError {
  errcode?: string;
  statusCode?: number;
  retryAfterMs?: number;
  retry_after_ms?: number;
}

function isRateLimitError(err: unknown): err is MatrixRateLimitError {
  if (typeof err !== "object" || err === null) return false;
  const e = err as MatrixRateLimitError;
  return e.errcode === "M_LIMIT_EXCEEDED" || e.statusCode === 429;
}

function extractRetryAfterMs(err: MatrixRateLimitError): number {
  // Matrix spec says retry_after_ms, but SDK may normalize to retryAfterMs
  return err.retryAfterMs ?? err.retry_after_ms ?? 1000;
}

function addJitter(ms: number): number {
  return ms + Math.floor(Math.random() * JITTER_MAX_MS);
}

async function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps a Matrix send operation with retry logic for rate limit errors.
 * - Retries up to maxRetries times on M_LIMIT_EXCEEDED (429)
 * - Respects retryAfterMs from the error response (+ small jitter)
 * - Aborts if total wait time would exceed maxTotalWaitMs
 * - Does NOT retry on other errors (M_FORBIDDEN, M_NOT_FOUND, etc.)
 * - Does NOT cause duplicate message delivery (single success path)
 */
export async function withRetryOnRateLimit<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const maxTotalWaitMs = options.maxTotalWaitMs ?? DEFAULT_MAX_TOTAL_WAIT_MS;
  const delayFn = options.delayFn ?? defaultDelay;

  let attempt = 0;
  let totalWaitMs = 0;

  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimitError(err)) {
        // Not a rate limit error - rethrow immediately
        throw err;
      }

      attempt++;
      if (attempt > maxRetries) {
        // Max retries exhausted - rethrow
        throw err;
      }

      const retryAfterMs = extractRetryAfterMs(err);
      const delayMs = addJitter(retryAfterMs);

      if (totalWaitMs + delayMs > maxTotalWaitMs) {
        // Would exceed max total wait - rethrow
        throw err;
      }

      totalWaitMs += delayMs;
      await delayFn(delayMs);
    }
  }
}
