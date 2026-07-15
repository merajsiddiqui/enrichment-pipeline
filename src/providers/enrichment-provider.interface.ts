import { BatchResolution, ProviderType } from './enrichment-provider.types';

/**
 * Contract every enrichment provider must satisfy.
 *
 * `EnrichmentService` depends only on this interface (Dependency Inversion)
 * — it has no knowledge of any concrete provider's HTTP shape, auth scheme,
 * wire schema, or rate-limit behavior. Adding a new provider means
 * implementing this interface and registering it in
 * `EnrichmentProviderManager`; `EnrichmentService` and the CLI/API layers
 * never change (Open/Closed).
 *
 * Deliberately a single-batch primitive, not a "resolve however many domains
 * you like" method: splitting a full domain list into batch-sized chunks,
 * running those chunks with bounded concurrency, and merging their results
 * is `EnrichmentService`'s job (it's the one thing every provider would
 * otherwise duplicate identically). A provider only owns what's actually
 * provider-specific — one batch call's wire format and its own resilience
 * against that one call failing.
 */
export interface EnrichmentProvider {
  /** Which provider this implementation talks to. */
  readonly type: ProviderType;

  /** Domains per batch call this provider should be handed, already capped at its own hard API limit — `EnrichmentService` chunks by this. */
  readonly batchSize: number;

  /** Max of this provider's batch calls `EnrichmentService` should run concurrently. */
  readonly concurrencyThreshold: number;

  /**
   * Resolve one batch — `domains.length` should be at most `batchSize`.
   * Handles that one batch's retries, item-level retryable requeues, and
   * adaptive splitting internally.
   */
  resolveBatch(domains: string[]): Promise<BatchResolution>;
}
