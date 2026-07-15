import { RetryableProviderError, withRetry } from './retry.util';

describe('RetryableProviderError', () => {
  it('carries an optional retryAfterSeconds and sets its name', () => {
    const err = new RetryableProviderError('rate limited', 3);
    expect(err.message).toBe('rate limited');
    expect(err.retryAfterSeconds).toBe(3);
    expect(err.name).toBe('RetryableProviderError');
    expect(err).toBeInstanceOf(Error);
  });

  it('retryAfterSeconds defaults to undefined', () => {
    const err = new RetryableProviderError('oops');
    expect(err.retryAfterSeconds).toBeUndefined();
  });
});

describe('withRetry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the result on the first successful attempt without waiting', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { maxRetries: 3 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on RetryableProviderError and eventually succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new RetryableProviderError('transient'))
      .mockRejectedValueOnce(new RetryableProviderError('transient'))
      .mockResolvedValueOnce('ok');

    const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });
    await jest.runAllTimersAsync();

    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('gives up after maxRetries and throws the last error', async () => {
    const fn = jest
      .fn()
      .mockRejectedValue(new RetryableProviderError('still failing'));

    const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 1 });
    // Attach a rejection handler immediately so the eventual rejection isn't
    // reported as unhandled while fake timers advance.
    const assertion = expect(promise).rejects.toThrow('still failing');
    await jest.runAllTimersAsync();
    await assertion;

    // initial attempt + 2 retries = 3 calls
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-RetryableProviderError — propagates immediately', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('permanent'));
    await expect(withRetry(fn, { maxRetries: 5 })).rejects.toThrow('permanent');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('honors retryAfterSeconds instead of exponential backoff when present', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new RetryableProviderError('rate limited', 5))
      .mockResolvedValueOnce('ok');

    const promise = withRetry(fn, { maxRetries: 1, baseDelayMs: 1 });

    // Not enough time for a 5s wait — should still be pending.
    await jest.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(1);

    // Now past the 5s retryAfterSeconds wait.
    await jest.advanceTimersByTimeAsync(5000);
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('invokes onRetry once per retry with the attempt number and error', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new RetryableProviderError('first'))
      .mockRejectedValueOnce(new RetryableProviderError('second'))
      .mockResolvedValueOnce('ok');
    const onRetry = jest.fn();

    const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 1, onRetry });
    await jest.runAllTimersAsync();
    await promise;

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(
      1,
      1,
      expect.objectContaining({ message: 'first' }),
      expect.any(Number),
    );
    expect(onRetry).toHaveBeenNthCalledWith(
      2,
      2,
      expect.objectContaining({ message: 'second' }),
      expect.any(Number),
    );
  });
});
