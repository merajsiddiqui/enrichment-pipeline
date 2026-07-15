/**
 * Thrown by a provider's HTTP call to signal a whole-request failure worth
 * retrying (429, 5xx, network error/timeout) — as opposed to a per-item
 * failure such as `NO_MATCH`, which is not retryable and should never throw.
 *
 * Callers react to the provider's own signals at call time (this error plus
 * an optional `Retry-After`) rather than assuming a fixed rate-limit shape —
 * a real provider's bucket size/refill rate isn't something to hardcode.
 */
export class RetryableProviderError extends Error {
  /**
   * @param message Human-readable failure reason.
   * @param retryAfterSeconds Seconds to wait before retrying, if the provider specified one (e.g. a `Retry-After` header).
   */
  constructor(
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'RetryableProviderError';
  }
}

/** Tuning for {@link withRetry}. */
export interface RetryOptions {
  /** Max retry attempts after the initial call. */
  maxRetries: number;
  /** Base delay for exponential backoff, in milliseconds (ignored when the error carries `retryAfterSeconds`). */
  baseDelayMs?: number;
  /** Ceiling for the exponential backoff delay, in milliseconds. */
  maxDelayMs?: number;
  /** Called right before each retry (not the initial attempt) — the only way a caller observes that a retry actually happened, since `withRetry` itself never logs. */
  onRetry?: (
    attempt: number,
    err: RetryableProviderError,
    delayMs: number,
  ) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls `fn`, retrying on {@link RetryableProviderError} up to `maxRetries`
 * times. If the error specifies `retryAfterSeconds`, waits exactly that long
 * before retrying; otherwise waits an exponentially increasing, jittered
 * delay. Any other error propagates immediately without retrying.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { maxRetries, baseDelayMs = 250, maxDelayMs = 8000, onRetry }: RetryOptions,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof RetryableProviderError) || attempt >= maxRetries) {
        throw err;
      }
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const jitter = Math.random() * backoff * 0.25;
      const delayMs = err.retryAfterSeconds
        ? err.retryAfterSeconds * 1000
        : backoff + jitter;
      attempt += 1;
      onRetry?.(attempt, err, delayMs);
      await sleep(delayMs);
    }
  }
}
