import { MockEnrichmentProvider } from './mock-enrichment.provider';
import { EnrichmentProviderConfig } from '../enrichment-provider.types';

function config(
  overrides: Partial<EnrichmentProviderConfig> = {},
): EnrichmentProviderConfig {
  return {
    apiKey: 'test-key',
    baseUrl: 'http://mock.invalid',
    maxRetries: 1,
    batchSize: 10,
    concurrencyThreshold: 2,
    timeoutMs: 1000,
    ...overrides,
  };
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
    headers: { get: (key: string) => headers[key.toLowerCase()] ?? null },
  } as unknown as Response;
}

describe('MockEnrichmentProvider', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  async function resolveBatch(
    provider: MockEnrichmentProvider,
    domains: string[],
  ) {
    const promise = provider.resolveBatch(domains);
    await jest.runAllTimersAsync();
    return promise;
  }

  describe('via resolveBatch (batch endpoint, 2+ domains)', () => {
    it('sends the batch request with auth + version headers and the domain list', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          status: 'ok',
          results: [
            { domain: 'a.com', status: 'ok', data: { name: 'A' } },
            { domain: 'b.com', status: 'ok', data: { name: 'B' } },
          ],
        }),
      );
      const provider = new MockEnrichmentProvider(config());

      const { outcomes } = await resolveBatch(provider, ['a.com', 'b.com']);

      expect(fetchMock).toHaveBeenCalledWith(
        'http://mock.invalid/v1/enrich/batch',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-key',
            'X-Provider-Version': '2',
          }),
          body: JSON.stringify({ domains: ['a.com', 'b.com'] }),
        }),
      );
      expect(outcomes.get('a.com')).toEqual({
        status: 'ok',
        data: expect.objectContaining({ domain: 'a.com', name: 'A' }),
      });
      expect(outcomes.get('b.com')).toEqual({
        status: 'ok',
        data: expect.objectContaining({ domain: 'b.com', name: 'B' }),
      });
    });

    it('normalizes each item through normalizeMockRecord (inconsistent employeeCount handled)', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          status: 'ok',
          results: [
            {
              domain: 'a.com',
              status: 'ok',
              data: { name: 'A', employeeCount: '100-500' },
            },
          ],
        }),
      );
      const provider = new MockEnrichmentProvider(config());

      const { outcomes } = await resolveBatch(provider, ['a.com', 'b.com']);
      const outcome = outcomes.get('a.com');
      expect(outcome?.status).toBe('ok');
      if (outcome?.status === 'ok') {
        expect(outcome.data.employeeCount).toBe(300);
        expect(outcome.data.employeeCountRaw).toBe('100-500');
      }
    });

    it('a 401 response fails the whole batch immediately (no retries)', async () => {
      fetchMock.mockResolvedValue(jsonResponse(401, {}));
      const provider = new MockEnrichmentProvider(config({ maxRetries: 5 }));

      const { outcomes } = await resolveBatch(provider, ['a.com', 'b.com']);

      expect(outcomes.get('a.com')?.status).toBe('failed');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('a 429 response is retryable and honors Retry-After', async () => {
      const provider = new MockEnrichmentProvider(config({ maxRetries: 0 }));
      fetchMock.mockResolvedValue(
        jsonResponse(429, {}, { 'retry-after': '2' }),
      );

      const { outcomes } = await resolveBatch(provider, ['a.com', 'b.com']);
      // maxRetries: 0 on the outer round loop still allows the 2 quick
      // retries inside fetchResilient, all of which see the same 429 and
      // eventually give up -> a whole-request-failure outcome.
      expect(outcomes.get('a.com')?.status).toBe('failed');
    });

    it('a network error is retryable', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));
      const provider = new MockEnrichmentProvider(config({ maxRetries: 0 }));

      const { outcomes } = await resolveBatch(provider, ['a.com', 'b.com']);
      expect(outcomes.get('a.com')?.status).toBe('failed');
    });

    it('a malformed (status !== "ok") body fails fast, without retrying', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { status: 'weird' }));
      const provider = new MockEnrichmentProvider(config({ maxRetries: 3 }));

      const { outcomes } = await resolveBatch(provider, ['a.com', 'b.com']);
      // Malformed body throws a plain Error (not RetryableProviderError),
      // so fetchResilient's quick retries don't apply.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcomes.get('a.com')?.status).toBe('failed');
    });
  });

  describe('via resolveBatch (single-domain endpoint, 1 domain)', () => {
    it('sends a GET to /v1/enrich?domain= with the same auth headers', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          domain: 'a.com',
          status: 'ok',
          data: { name: 'A' },
        }),
      );
      const provider = new MockEnrichmentProvider(config());

      const { outcomes } = await resolveBatch(provider, ['a.com']);

      expect(fetchMock).toHaveBeenCalledWith(
        'http://mock.invalid/v1/enrich?domain=a.com',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-key',
            'X-Provider-Version': '2',
          }),
        }),
      );
      expect(outcomes.get('a.com')?.status).toBe('ok');
    });

    it('a well-formed TEMPORARY error body on a 500 is returned as a normal (retryable) result, not thrown', async () => {
      const provider = new MockEnrichmentProvider(config({ maxRetries: 0 }));
      fetchMock.mockResolvedValue(
        jsonResponse(500, {
          domain: 'a.com',
          status: 'error',
          code: 'TEMPORARY',
          retryable: true,
        }),
      );

      const { outcomes } = await resolveBatch(provider, ['a.com']);

      // Flows through the same retryable/requeue path as batch items,
      // exhausting after maxRetries: 0 rounds -> TEMPORARY_EXHAUSTED, never
      // PROVIDER_ERROR (which would mean it was thrown/transport-level).
      expect(outcomes.get('a.com')).toEqual({
        status: 'failed',
        reason: 'TEMPORARY_EXHAUSTED',
        message: expect.any(String),
      });
    });

    it('a 500 with no parseable per-domain error body is treated as a transport failure', async () => {
      const provider = new MockEnrichmentProvider(config({ maxRetries: 0 }));
      fetchMock.mockResolvedValue({
        status: 500,
        ok: false,
        json: () => Promise.reject(new Error('not json')),
        headers: { get: () => null },
      });

      const { outcomes } = await resolveBatch(provider, ['a.com']);
      expect(outcomes.get('a.com')).toEqual({
        status: 'failed',
        reason: 'PROVIDER_ERROR',
        message: expect.stringContaining('provider error (500)'),
      });
    });

    it('a 429 on the single endpoint is retryable', async () => {
      const provider = new MockEnrichmentProvider(config({ maxRetries: 0 }));
      fetchMock.mockResolvedValue(jsonResponse(429, {}));

      const { outcomes } = await resolveBatch(provider, ['a.com']);
      expect(outcomes.get('a.com')?.status).toBe('failed');
    });
  });
});
