import { EnrichmentProviderManager } from './enrichment-provider-manager.service';
import { ProviderType } from './enrichment-provider.types';
import { MockEnrichmentProvider } from './mock/mock-enrichment.provider';

describe('EnrichmentProviderManager', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.MOCK_PROVIDER_API_KEY;
    delete process.env.MOCK_PROVIDER_URL;
    delete process.env.MOCK_PROVIDER_MAX_RETRIES;
    delete process.env.MOCK_PROVIDER_BATCH_SIZE;
    delete process.env.MOCK_PROVIDER_CONCURRENCY;
    delete process.env.MOCK_PROVIDER_TIMEOUT_MS;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('builds a MockEnrichmentProvider for ProviderType.MOCK using env-based defaults', () => {
    process.env.MOCK_PROVIDER_API_KEY = 'env-key';
    process.env.MOCK_PROVIDER_BATCH_SIZE = '7';
    process.env.MOCK_PROVIDER_CONCURRENCY = '3';

    const manager = new EnrichmentProviderManager();
    const provider = manager.getProvider(ProviderType.MOCK);

    expect(provider).toBeInstanceOf(MockEnrichmentProvider);
    expect(provider.type).toBe(ProviderType.MOCK);
    expect(provider.batchSize).toBe(7);
    expect(provider.concurrencyThreshold).toBe(3);
  });

  it('layers defined overrides over the environment defaults', () => {
    process.env.MOCK_PROVIDER_API_KEY = 'env-key';
    process.env.MOCK_PROVIDER_BATCH_SIZE = '10';

    const manager = new EnrichmentProviderManager();
    const provider = manager.getProvider(ProviderType.MOCK, { batchSize: 3 });

    expect(provider.batchSize).toBe(3);
  });

  it('ignores undefined override fields — they do not clobber a defined default', () => {
    process.env.MOCK_PROVIDER_API_KEY = 'env-key';
    process.env.MOCK_PROVIDER_BATCH_SIZE = '10';

    const manager = new EnrichmentProviderManager();
    const provider = manager.getProvider(ProviderType.MOCK, {
      batchSize: undefined,
    });

    expect(provider.batchSize).toBe(10);
  });

  it('an override can supply the API key when the environment has none', () => {
    const manager = new EnrichmentProviderManager();
    expect(() =>
      manager.getProvider(ProviderType.MOCK, { apiKey: 'override-key' }),
    ).not.toThrow();
  });

  it('throws if no API key is configured by either env or override', () => {
    const manager = new EnrichmentProviderManager();
    expect(() => manager.getProvider(ProviderType.MOCK)).toThrow(
      /no API key configured for provider "mock"/,
    );
  });

  it('throws for an unknown provider type', () => {
    process.env.MOCK_PROVIDER_API_KEY = 'env-key';
    const manager = new EnrichmentProviderManager();
    expect(() => manager.getProvider('bogus' as ProviderType)).toThrow(
      /unknown provider type: "bogus"/,
    );
  });

  it('falls back to documented defaults when env vars are entirely unset (except the required key)', () => {
    process.env.MOCK_PROVIDER_API_KEY = 'env-key';
    const manager = new EnrichmentProviderManager();
    const provider = manager.getProvider(ProviderType.MOCK);

    // Documented .env.example defaults.
    expect(provider.batchSize).toBe(10);
    expect(provider.concurrencyThreshold).toBe(4);
  });
});
