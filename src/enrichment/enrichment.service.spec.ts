import { EnrichmentService } from './enrichment.service';
import { EnrichmentProviderManager } from '../providers/enrichment-provider-manager.service';
import { EnrichmentProvider } from '../providers/enrichment-provider.interface';
import {
  ProviderType,
  ResolvedOutcome,
} from '../providers/enrichment-provider.types';
import { ResolvedOutcomeStore } from '../outcome-store/resolved-outcome-store.interface';

function ok(domain: string): ResolvedOutcome {
  return {
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

function fakeProvider(
  overrides: Partial<EnrichmentProvider> = {},
): jest.Mocked<EnrichmentProvider> {
  return {
    type: ProviderType.MOCK,
    batchSize: 25,
    concurrencyThreshold: 4,
    resolveBatch: jest.fn(),
    ...overrides,
  } as jest.Mocked<EnrichmentProvider>;
}

function fakeStore(): jest.Mocked<ResolvedOutcomeStore> {
  return {
    has: jest.fn().mockResolvedValue(false),
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

describe('EnrichmentService', () => {
  let providerManager: jest.Mocked<EnrichmentProviderManager>;
  let service: EnrichmentService;
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.DEFAULT_ENRICHMENT_PROVIDER;
    providerManager = {
      getProvider: jest.fn(),
    } as unknown as jest.Mocked<EnrichmentProviderManager>;
    service = new EnrichmentService(providerManager);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('asks the provider manager for the requested provider type + config', async () => {
    const provider = fakeProvider({
      resolveBatch: jest
        .fn()
        .mockResolvedValue({ outcomes: new Map(), retries: 0 }),
    });
    providerManager.getProvider.mockReturnValue(provider);
    const store = fakeStore();

    await service.enrich([], store, ProviderType.MOCK, { apiKey: 'x' });

    expect(providerManager.getProvider).toHaveBeenCalledWith(
      ProviderType.MOCK,
      { apiKey: 'x' },
    );
  });

  it('defaults to ProviderType.MOCK when no providerType and no env var is given', async () => {
    const provider = fakeProvider({
      resolveBatch: jest
        .fn()
        .mockResolvedValue({ outcomes: new Map(), retries: 0 }),
    });
    providerManager.getProvider.mockReturnValue(provider);

    await service.enrich(['a.com'], fakeStore());

    expect(providerManager.getProvider).toHaveBeenCalledWith(
      ProviderType.MOCK,
      {},
    );
  });

  it('honors DEFAULT_ENRICHMENT_PROVIDER when no explicit providerType is given', async () => {
    process.env.DEFAULT_ENRICHMENT_PROVIDER = ProviderType.MOCK;
    const provider = fakeProvider({
      resolveBatch: jest
        .fn()
        .mockResolvedValue({ outcomes: new Map(), retries: 0 }),
    });
    providerManager.getProvider.mockReturnValue(provider);

    await service.enrich(['a.com'], fakeStore());

    expect(providerManager.getProvider).toHaveBeenCalledWith(
      ProviderType.MOCK,
      {},
    );
  });

  it("chunks the domain list by the provider's batchSize and calls resolveBatch once per chunk", async () => {
    const provider = fakeProvider({
      batchSize: 2,
      resolveBatch: jest
        .fn()
        .mockResolvedValue({ outcomes: new Map(), retries: 0 }),
    });
    providerManager.getProvider.mockReturnValue(provider);

    await service.enrich(
      ['a.com', 'b.com', 'c.com', 'd.com', 'e.com'],
      fakeStore(),
    );

    expect(provider.resolveBatch).toHaveBeenCalledTimes(3);
    expect(provider.resolveBatch).toHaveBeenCalledWith(['a.com', 'b.com']);
    expect(provider.resolveBatch).toHaveBeenCalledWith(['c.com', 'd.com']);
    expect(provider.resolveBatch).toHaveBeenCalledWith(['e.com']);
  });

  it('makes no calls at all for an empty domain list', async () => {
    const provider = fakeProvider({ resolveBatch: jest.fn() });
    providerManager.getProvider.mockReturnValue(provider);

    await service.enrich([], fakeStore());

    expect(provider.resolveBatch).not.toHaveBeenCalled();
  });

  it("merges every batch's outcomes into the supplied store", async () => {
    const provider = fakeProvider({
      batchSize: 2,
      resolveBatch: jest
        .fn()
        .mockResolvedValueOnce({
          outcomes: new Map([
            ['a.com', ok('a.com')],
            ['b.com', ok('b.com')],
          ]),
          retries: 0,
        })
        .mockResolvedValueOnce({
          outcomes: new Map([['c.com', ok('c.com')]]),
          retries: 0,
        }),
    });
    providerManager.getProvider.mockReturnValue(provider);
    const store = fakeStore();

    await service.enrich(['a.com', 'b.com', 'c.com'], store);

    expect(store.set).toHaveBeenCalledWith('a.com', ok('a.com'));
    expect(store.set).toHaveBeenCalledWith('b.com', ok('b.com'));
    expect(store.set).toHaveBeenCalledWith('c.com', ok('c.com'));
    expect(store.set).toHaveBeenCalledTimes(3);
  });

  it("caps concurrent resolveBatch calls at the provider's concurrencyThreshold", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const provider = fakeProvider({
      batchSize: 1,
      concurrencyThreshold: 2,
      resolveBatch: jest.fn().mockImplementation(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
        return { outcomes: new Map(), retries: 0 };
      }),
    });
    providerManager.getProvider.mockReturnValue(provider);

    await service.enrich(
      ['a.com', 'b.com', 'c.com', 'd.com', 'e.com', 'f.com'],
      fakeStore(),
    );

    expect(maxInFlight).toBe(2);
    expect(provider.resolveBatch).toHaveBeenCalledTimes(6);
  });

  it('invokes onBatchResolved once per batch with correct progress info', async () => {
    const provider = fakeProvider({
      batchSize: 2,
      resolveBatch: jest.fn().mockResolvedValue({
        outcomes: new Map([
          ['a.com', ok('a.com')],
          ['b.com', { status: 'failed', reason: 'NO_MATCH' }],
        ]),
        retries: 3,
      }),
    });
    providerManager.getProvider.mockReturnValue(provider);
    const onBatchResolved = jest.fn();

    await service.enrich(
      ['a.com', 'b.com'],
      fakeStore(),
      undefined,
      {},
      onBatchResolved,
    );

    expect(onBatchResolved).toHaveBeenCalledTimes(1);
    expect(onBatchResolved).toHaveBeenCalledWith({
      batchIndex: 1,
      totalBatches: 1,
      size: 2,
      succeeded: 1,
      failed: 1,
      retries: 3,
    });
  });
});
