/**
 * Shared types for the provider layer: what a provider is configured with,
 * the standard shape every provider must transform its own response into,
 * and the vocabulary used to describe why a domain wasn't enriched.
 *
 * This file has no dependency on `src/enrichment/*` — `enrichment.types.ts`
 * depends on this file, never the other way around, since the provider
 * layer is a standalone module (`ProvidersModule`) that `EnrichmentModule`
 * consumes, not the reverse.
 */

/**
 * Identifies which concrete enrichment provider implementation to use.
 * `EnrichmentProviderManager` maps each value to a concrete class; adding a
 * new provider means adding a value here and an entry in the manager —
 * `EnrichmentService` and the CLI/API layers never need to change.
 */
export enum ProviderType {
  MOCK = 'mock',
}

/**
 * Per-provider tunables. Every provider owns its own resilience profile —
 * a real vendor's auth scheme, rate limits, and batch limits are never the
 * same as another's, so these are per-provider config, not global settings.
 */
export interface EnrichmentProviderConfig {
  /** Bearer token / API key for this provider. */
  apiKey: string;
  /** Base URL of the provider's API. */
  baseUrl: string;
  /** Max retry rounds on retryable failures (429 / 5xx / a response item marked `retryable`). */
  maxRetries: number;
  /** Domains requested per HTTP call. Capped internally at the provider's own hard API limit. */
  batchSize: number;
  /**
   * Max concurrent in-flight requests to this provider — the "threshold"
   * past which no new request is issued until one finishes. Modeled here as
   * an in-flight concurrency cap (a semaphore) rather than a requests/sec
   * rate limiter; if a rate-per-second limit was intended instead, this is
   * the field to change.
   */
  concurrencyThreshold: number;
  /** Per-request timeout, in milliseconds. */
  timeoutMs: number;
}

/**
 * A company record normalized to one stable shape regardless of which
 * provider produced it or how inconsistently that provider's own API shapes
 * its fields (e.g. `employeeCount` as a number, a banded string, or `null`).
 */
export interface EnrichedCompanyData {
  domain: string;
  name: string | null;
  employeeCount: number | null;
  /** The value as the provider actually returned it, before normalization — kept so nothing is silently discarded. */
  employeeCountRaw: string | number | null;
  industry: string[];
  location: { city: string | null; country: string | null };
  foundedYear: number | null;
  annualRevenueUsd: number | null;
}

/** Why a domain wasn't enriched, surfaced to operators in the output/summary. */
export type FailureReason =
  | 'INVALID_DOMAIN'
  | 'NO_MATCH'
  | 'TEMPORARY_EXHAUSTED'
  | 'UNAUTHORIZED'
  | 'PROVIDER_ERROR';

/** The final, provider-agnostic outcome for a single normalized domain, once all retries are exhausted. */
export type ResolvedOutcome =
  | { status: 'ok'; data: EnrichedCompanyData }
  | { status: 'failed'; reason: FailureReason; message?: string };

/** What `EnrichmentProvider.resolveBatch` returns for one batch. */
export interface BatchResolution {
  /** One final outcome per domain in that batch, keyed by the normalized domain string. */
  outcomes: Map<string, ResolvedOutcome>;
  /**
   * Total retry attempts this batch needed — both quick whole-request
   * retries (rate limiting, transient errors) and item-level retry rounds
   * for domains a response marked `retryable`. Purely a diagnostic count
   * surfaced up to `BatchProgress`; nothing branches on it.
   */
  retries: number;
}

/**
 * The standard enrichment response format: every provider's own raw wire
 * response — whatever shape that provider actually returns — must be
 * transformed into an array of these before it leaves the provider (see
 * `BaseHttpEnrichmentProvider.toStandardResponses`). Nothing outside the
 * provider layer ever sees a provider's native/raw response shape; this is
 * the one shape every provider is required to produce.
 */
export interface StandardEnrichmentResponse {
  domain: string;
  status: 'ok' | 'error';
  /** True if this specific item is worth retrying (e.g. a transient upstream blip). */
  retryable?: boolean;
  /** Provider-specific error code, surfaced to operators, e.g. `"NO_MATCH"`. */
  code?: string;
  message?: string;
  /** Present when `status` is `"ok"`. */
  data?: EnrichedCompanyData;
}
