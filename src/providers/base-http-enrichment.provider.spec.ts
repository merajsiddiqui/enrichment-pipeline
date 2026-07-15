import { BaseHttpEnrichmentProvider } from './base-http-enrichment.provider';
import { RetryableProviderError } from '../enrichment/util/retry.util';
import {
  EnrichmentProviderConfig,
  ProviderType,
  StandardEnrichmentResponse,
} from './enrichment-provider.types';

/**
 * Minimal concrete subclass for exercising `BaseHttpEnrichmentProvider`'s
 * resilience machinery in isolation, without any real HTTP. Raw request/
 * response types are `StandardEnrichmentResponse` itself, so
 * `toStandard*Responses` are pure identity — tests control exactly what
 * "the wire" returns via `sendBatchRequestMock`/`sendSingleRequestMock`.
 */
class TestProvider extends BaseHttpEnrichmentProvider<
  StandardEnrichmentResponse[],
  StandardEnrichmentResponse
> {
  readonly type = ProviderType.MOCK;
  protected readonly maxBatchSize: number;

  readonly sendBatchRequestMock = jest.fn<
    Promise<StandardEnrichmentResponse[]>,
    [string[]]
  >();
  readonly sendSingleRequestMock = jest.fn<
    Promise<StandardEnrichmentResponse>,
    [string]
  >();

  constructor(config: EnrichmentProviderConfig, maxBatchSize = 100) {
    super(config);
    this.maxBatchSize = maxBatchSize;
  }

  protected sendBatchRequest(
    domains: string[],
  ): Promise<StandardEnrichmentResponse[]> {
    return this.sendBatchRequestMock(domains);
  }

  protected sendSingleRequest(
    domain: string,
  ): Promise<StandardEnrichmentResponse> {
    return this.sendSingleRequestMock(domain);
  }

  protected toStandardBatchResponses(
    raw: StandardEnrichmentResponse[],
  ): StandardEnrichmentResponse[] {
    return raw;
  }

  protected toStandardSingleResponse(
    raw: StandardEnrichmentResponse,
  ): StandardEnrichmentResponse {
    return raw;
  }
}

function ok(domain: string): StandardEnrichmentResponse {
  return {
    domain,
    status: 'ok',
    data: {
      domain,
      name: 'Co',
      employeeCount: 1,
      employeeCountRaw: 1,
      industry: [],
      location: { city: null, country: null },
      foundedYear: null,
      annualRevenueUsd: null,
    },
  };
}

function config(
  overrides: Partial<EnrichmentProviderConfig> = {},
): EnrichmentProviderConfig {
  return {
    apiKey: 'test-key',
    baseUrl: 'http://example.invalid',
    maxRetries: 3,
    batchSize: 10,
    concurrencyThreshold: 4,
    timeoutMs: 1000,
    ...overrides,
  };
}

describe('BaseHttpEnrichmentProvider', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function runResolveBatch(provider: TestProvider, domains: string[]) {
    const promise = provider.resolveBatch(domains);
    await jest.runAllTimersAsync();
    return promise;
  }

  describe('batchSize / concurrencyThreshold getters', () => {
    it('caps batchSize at the provider hard ceiling (maxBatchSize)', () => {
      const provider = new TestProvider(config({ batchSize: 50 }), 25);
      expect(provider.batchSize).toBe(25);
    });

    it('uses config.batchSize when under the ceiling', () => {
      const provider = new TestProvider(config({ batchSize: 5 }), 25);
      expect(provider.batchSize).toBe(5);
    });

    it('never goes below 1', () => {
      const provider = new TestProvider(config({ batchSize: 0 }), 25);
      expect(provider.batchSize).toBe(1);
    });

    it('concurrencyThreshold mirrors config.concurrencyThreshold', () => {
      const provider = new TestProvider(config({ concurrencyThreshold: 7 }));
      expect(provider.concurrencyThreshold).toBe(7);
    });
  });

  describe('routing', () => {
    it('routes a single domain to sendSingleRequest, not sendBatchRequest', async () => {
      const provider = new TestProvider(config());
      provider.sendSingleRequestMock.mockResolvedValue(ok('a.com'));

      const { outcomes } = await runResolveBatch(provider, ['a.com']);

      expect(provider.sendSingleRequestMock).toHaveBeenCalledWith('a.com');
      expect(provider.sendBatchRequestMock).not.toHaveBeenCalled();
      expect(outcomes.get('a.com')).toEqual({
        status: 'ok',
        data: ok('a.com').data,
      });
    });

    it('routes 2+ domains to sendBatchRequest', async () => {
      const provider = new TestProvider(config());
      provider.sendBatchRequestMock.mockResolvedValue([
        ok('a.com'),
        ok('b.com'),
      ]);

      await runResolveBatch(provider, ['a.com', 'b.com']);

      expect(provider.sendBatchRequestMock).toHaveBeenCalledWith([
        'a.com',
        'b.com',
      ]);
      expect(provider.sendSingleRequestMock).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('resolves every domain to "ok" with 0 retries when the batch succeeds first try', async () => {
      const provider = new TestProvider(config());
      provider.sendBatchRequestMock.mockResolvedValue([
        ok('a.com'),
        ok('b.com'),
      ]);

      const { outcomes, retries } = await runResolveBatch(provider, [
        'a.com',
        'b.com',
      ]);

      expect(retries).toBe(0);
      expect(outcomes.get('a.com')?.status).toBe('ok');
      expect(outcomes.get('b.com')?.status).toBe('ok');
      expect(provider.sendBatchRequestMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('per-item outcome classification', () => {
    it('maps a NO_MATCH item to a failed/NO_MATCH outcome', async () => {
      const provider = new TestProvider(config());
      provider.sendBatchRequestMock.mockResolvedValue([
        {
          domain: 'a.com',
          status: 'error',
          code: 'NO_MATCH',
          message: 'no match',
        },
        ok('b.com'),
      ]);

      const { outcomes } = await runResolveBatch(provider, ['a.com', 'b.com']);

      expect(outcomes.get('a.com')).toEqual({
        status: 'failed',
        reason: 'NO_MATCH',
        message: 'no match',
      });
    });

    it('maps an UNAUTHORIZED item to a failed/UNAUTHORIZED outcome', async () => {
      const provider = new TestProvider(config());
      provider.sendBatchRequestMock.mockResolvedValue([
        {
          domain: 'a.com',
          status: 'error',
          code: 'UNAUTHORIZED',
          message: 'bad token',
        },
      ]);

      const { outcomes } = await runResolveBatch(provider, ['a.com', 'b.com']);
      // b.com never gets a response item — but since it's not requeued
      // (not retryable) it's simply absent unless the provider returned it.
      expect(outcomes.get('a.com')).toEqual({
        status: 'failed',
        reason: 'UNAUTHORIZED',
        message: 'bad token',
      });
    });

    it('maps an unrecognized error code to failed/PROVIDER_ERROR', async () => {
      const provider = new TestProvider(config());
      provider.sendBatchRequestMock.mockResolvedValue([
        { domain: 'a.com', status: 'error', code: 'WEIRD', message: 'huh' },
      ]);

      const { outcomes } = await runResolveBatch(provider, ['a.com', 'b.com']);
      expect(outcomes.get('a.com')).toEqual({
        status: 'failed',
        reason: 'PROVIDER_ERROR',
        message: 'huh',
      });
    });
  });

  describe('item-level retry and requeue', () => {
    it('requeues a retryable item into the next round and resolves it there', async () => {
      const provider = new TestProvider(config({ maxRetries: 3 }));
      provider.sendBatchRequestMock.mockResolvedValueOnce([
        {
          domain: 'a.com',
          status: 'error',
          code: 'TEMPORARY',
          retryable: true,
        },
        ok('b.com'),
      ]);
      // Only 'a.com' is requeued for round 2 — a single remaining domain
      // routes through the single-domain endpoint, not the batch one.
      provider.sendSingleRequestMock.mockResolvedValueOnce(ok('a.com'));

      const { outcomes, retries } = await runResolveBatch(provider, [
        'a.com',
        'b.com',
      ]);

      expect(outcomes.get('a.com')?.status).toBe('ok');
      expect(outcomes.get('b.com')?.status).toBe('ok');
      expect(retries).toBeGreaterThanOrEqual(1);
      expect(provider.sendBatchRequestMock).toHaveBeenCalledTimes(1);
      expect(provider.sendSingleRequestMock).toHaveBeenCalledWith('a.com');
    });

    it('gives up after maxRetries rounds and marks it TEMPORARY_EXHAUSTED', async () => {
      const provider = new TestProvider(config({ maxRetries: 2 }));
      // Both domains stay retryable every round, so `remaining` never drops
      // to 1 and every round goes through the batch endpoint.
      provider.sendBatchRequestMock.mockResolvedValue([
        {
          domain: 'a.com',
          status: 'error',
          code: 'TEMPORARY',
          retryable: true,
        },
        {
          domain: 'b.com',
          status: 'error',
          code: 'TEMPORARY',
          retryable: true,
        },
      ]);

      const { outcomes } = await runResolveBatch(provider, ['a.com', 'b.com']);

      expect(outcomes.get('a.com')).toEqual({
        status: 'failed',
        reason: 'TEMPORARY_EXHAUSTED',
        message: expect.stringContaining('still failing after 2 retries'),
      });
      expect(outcomes.get('b.com')).toEqual({
        status: 'failed',
        reason: 'TEMPORARY_EXHAUSTED',
        message: expect.stringContaining('still failing after 2 retries'),
      });
      // initial round + 2 retries = 3 calls
      expect(provider.sendBatchRequestMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('whole-request failure handling', () => {
    it('adaptively splits a persistently-rejected batch and resolves the halves independently', async () => {
      const provider = new TestProvider(config({ maxRetries: 1 }));
      provider.sendBatchRequestMock.mockRejectedValue(
        new RetryableProviderError('rate limited'),
      );
      provider.sendSingleRequestMock.mockImplementation((domain) =>
        Promise.resolve(ok(domain)),
      );

      // 4 domains: batch calls keep failing -> splits down to single-domain
      // calls, which succeed via sendSingleRequestMock.
      const { outcomes } = await runResolveBatch(provider, [
        'a.com',
        'b.com',
        'c.com',
        'd.com',
      ]);

      expect(outcomes.get('a.com')?.status).toBe('ok');
      expect(outcomes.get('b.com')?.status).toBe('ok');
      expect(outcomes.get('c.com')?.status).toBe('ok');
      expect(outcomes.get('d.com')?.status).toBe('ok');
      expect(provider.sendSingleRequestMock).toHaveBeenCalledTimes(4);
    });

    it('marks every domain PROVIDER_ERROR (not TEMPORARY_EXHAUSTED) when a single-domain request keeps failing', async () => {
      const provider = new TestProvider(config({ maxRetries: 1 }));
      provider.sendSingleRequestMock.mockRejectedValue(
        new RetryableProviderError('still down'),
      );

      const { outcomes } = await runResolveBatch(provider, ['a.com']);

      expect(outcomes.get('a.com')).toEqual({
        status: 'failed',
        reason: 'PROVIDER_ERROR',
        message: 'still down',
      });
    });

    it('a non-retryable error thrown from sendBatchRequest fails the whole batch immediately as PROVIDER_ERROR', async () => {
      const provider = new TestProvider(config({ maxRetries: 3 }));
      provider.sendBatchRequestMock.mockRejectedValue(
        new Error('malformed response'),
      );

      const { outcomes } = await runResolveBatch(provider, ['a.com', 'b.com']);

      expect(outcomes.get('a.com')).toEqual({
        status: 'failed',
        reason: 'PROVIDER_ERROR',
        message: 'malformed response',
      });
      expect(outcomes.get('b.com')).toEqual({
        status: 'failed',
        reason: 'PROVIDER_ERROR',
        message: 'malformed response',
      });
      // Not retryable, so no retry rounds — one attempt only.
      expect(provider.sendBatchRequestMock).toHaveBeenCalledTimes(1);
    });
  });
});
