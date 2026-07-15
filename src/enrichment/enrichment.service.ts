import { Injectable, Logger } from '@nestjs/common';
import { EnrichmentProviderManager } from '../providers/enrichment-provider-manager.service';
import {
  EnrichmentProviderConfig,
  ProviderType,
} from '../providers/enrichment-provider.types';
import { Semaphore } from './util/semaphore.util';
import { BatchProgress } from './enrichment.types';
import { ResolvedOutcomeStore } from '../outcome-store/resolved-outcome-store.interface';

/**
 * Resolves a list of domains through a provider, end to end: decides which
 * provider to use (via `EnrichmentProviderManager`), splits the list into
 * that provider's own batch size, runs those batches with bounded
 * concurrency, and merges every batch's result into the caller-supplied
 * `ResolvedOutcomeStore`.
 *
 * Example: 50 domains through a provider configured with a batch size of 25
 * means two calls to `provider.resolveBatch` — one per 25-domain chunk —
 * whose results this service merges into the store as each completes.
 *
 * The store, not a `Map` this method builds and returns itself, is where
 * results end up — that's what makes *how* a run holds its results (fully
 * in memory, or spilled to disk once written) a decision the caller makes
 * (see `createOutcomeStore`), not something baked into this class. This
 * service still owns the merge; it just merges into storage it doesn't own.
 *
 * Providers themselves stay single-batch primitives (see
 * `EnrichmentProvider`/`BaseHttpEnrichmentProvider`); the fan-out-and-merge
 * logic lives here once instead of being duplicated into every provider.
 *
 * A provider instance is resolved fresh for each `enrich` call and never
 * reused across calls — its concurrency semaphore is likewise a local
 * variable scoped to that one call — so callers must hand this method the
 * *complete* domain list for a run in a single call rather than calling it
 * once per page; there's no cross-call state for a provider or a run to
 * share.
 */
@Injectable()
export class EnrichmentService {
  private readonly logger = new Logger(EnrichmentService.name);

  constructor(private readonly providerManager: EnrichmentProviderManager) {}

  /**
   * @param domains Already validated, normalized, deduplicated domains to resolve.
   * @param store Where each domain's outcome is written as its batch resolves.
   * @param providerType Which provider to use. Defaults to the `DEFAULT_ENRICHMENT_PROVIDER` env var, falling back to `ProviderType.MOCK` if that's unset.
   * @param providerConfig Overrides layered over that provider's environment-based defaults.
   * @param onBatchResolved Optional per-batch progress hook, invoked once each outer batch settles (i.e. once per `provider.resolveBatch` call, in whatever order they finish). Nothing here calls it — it's purely an opt-in extension point for a caller that wants batch-level visibility (e.g. the CLI); the HTTP API doesn't pass one, so a request's batches never get logged to the server console.
   */
  async enrich(
    domains: string[],
    store: ResolvedOutcomeStore,
    providerType?: ProviderType,
    providerConfig: Partial<EnrichmentProviderConfig> = {},
    onBatchResolved?: (progress: BatchProgress) => void,
  ): Promise<void> {
    const provider = this.providerManager.getProvider(
      providerType ?? this.defaultProviderType(),
      providerConfig,
    );

    const batches: string[][] = [];
    for (let i = 0; i < domains.length; i += provider.batchSize) {
      batches.push(domains.slice(i, i + provider.batchSize));
    }

    this.logger.log(
      `resolving ${domains.length} domain(s) via "${provider.type}" as ${batches.length} batch(es) of up to ${provider.batchSize}, concurrency ${provider.concurrencyThreshold}`,
    );

    const semaphore = new Semaphore(provider.concurrencyThreshold);

    await Promise.all(
      batches.map((batch, index) =>
        semaphore.run(async () => {
          const { outcomes, retries } = await provider.resolveBatch(batch);
          let succeeded = 0;
          let failed = 0;
          for (const [domain, outcome] of outcomes) {
            await store.set(domain, outcome);
            if (outcome.status === 'ok') {
              succeeded += 1;
            } else {
              failed += 1;
            }
          }
          onBatchResolved?.({
            batchIndex: index + 1,
            totalBatches: batches.length,
            size: batch.length,
            succeeded,
            failed,
            retries,
          });
        }),
      ),
    );
  }

  private defaultProviderType(): ProviderType {
    const fromEnv = process.env.DEFAULT_ENRICHMENT_PROVIDER as
      ProviderType | undefined;
    return fromEnv && Object.values(ProviderType).includes(fromEnv)
      ? fromEnv
      : ProviderType.MOCK;
  }
}
