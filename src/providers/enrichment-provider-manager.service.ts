import { Injectable } from '@nestjs/common';
import { EnrichmentProvider } from './enrichment-provider.interface';
import {
  EnrichmentProviderConfig,
  ProviderType,
} from './enrichment-provider.types';
import { MockEnrichmentProvider } from './mock/mock-enrichment.provider';

/**
 * Builds the concrete `EnrichmentProvider` for a requested `ProviderType`.
 *
 * This is the one place in the app that knows the mapping from
 * `ProviderType` to a concrete class — `EnrichmentService` and the CLI/API
 * layers depend only on the `EnrichmentProvider` interface, never on a
 * specific implementation (Dependency Inversion). Adding a second provider
 * means adding an enum value plus one entry each in `defaults` and
 * `factories` below — nothing else in the app changes (Open/Closed).
 *
 * Providers are built with `new` here rather than resolved as Nest-managed
 * singletons: their config (API key, batch size, provider choice) is
 * per-invocation — a CLI run or an API request can each pick a different
 * provider or override its tuning — so there's no single shared instance for
 * the DI container to inject. `EnrichmentProviderManager` itself is the
 * (stateless, cheap) abstraction Nest injects instead.
 */
@Injectable()
export class EnrichmentProviderManager {
  /** Default config per provider, sourced from environment variables. */
  private readonly defaults: Record<ProviderType, EnrichmentProviderConfig> = {
    [ProviderType.MOCK]: {
      apiKey: process.env.MOCK_PROVIDER_API_KEY ?? '',
      baseUrl: process.env.MOCK_PROVIDER_URL ?? 'http://localhost:4000',
      maxRetries: Number(process.env.MOCK_PROVIDER_MAX_RETRIES ?? 5),
      batchSize: Number(process.env.MOCK_PROVIDER_BATCH_SIZE ?? 10),
      concurrencyThreshold: Number(process.env.MOCK_PROVIDER_CONCURRENCY ?? 4),
      timeoutMs: Number(process.env.MOCK_PROVIDER_TIMEOUT_MS ?? 10_000),
    },
  };

  /** Constructors for each provider, keyed by type — a map instead of a `switch` so the set of known types stays exhaustive without an unreachable `default`. */
  private readonly factories: Record<
    ProviderType,
    (config: EnrichmentProviderConfig) => EnrichmentProvider
  > = {
    [ProviderType.MOCK]: (config) => new MockEnrichmentProvider(config),
  };

  /**
   * Returns a ready-to-use provider for `type`, merging `overrides` (e.g.
   * CLI flags or API request fields) over that provider's environment-based
   * defaults. Throws if `type` is unknown or no API key ends up configured.
   */
  getProvider(
    type: ProviderType,
    overrides: Partial<EnrichmentProviderConfig> = {},
  ): EnrichmentProvider {
    const base = this.defaults[type];
    if (!base) {
      throw new Error(`unknown provider type: "${type}"`);
    }

    const definedOverrides = Object.fromEntries(
      Object.entries(overrides).filter(([, value]) => value !== undefined),
    );
    const config: EnrichmentProviderConfig = { ...base, ...definedOverrides };

    if (!config.apiKey) {
      throw new Error(
        `no API key configured for provider "${type}" (pass one, or set MOCK_PROVIDER_API_KEY)`,
      );
    }

    return this.factories[type](config);
  }
}
