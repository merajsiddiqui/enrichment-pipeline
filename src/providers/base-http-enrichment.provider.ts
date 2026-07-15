import { Logger } from '@nestjs/common';
import {
  withRetry,
  RetryableProviderError,
} from '../enrichment/util/retry.util';
import { EnrichmentProvider } from './enrichment-provider.interface';
import {
  BatchResolution,
  EnrichmentProviderConfig,
  ProviderType,
  ResolvedOutcome,
  StandardEnrichmentResponse,
} from './enrichment-provider.types';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Shared resilience machinery for HTTP-based enrichment providers: resolving
 * one batch's worth of domains, retrying transient failures with backoff,
 * requeueing item-level retryable failures, and adaptively splitting a batch
 * that keeps failing rather than assuming any fixed size is safe.
 *
 * Concrete providers implement two request/response pairs — one for the
 * provider's batch endpoint (`sendBatchRequest` / `toStandardBatchResponses`,
 * generic `TRawBatchResponse`) and one for its single-domain endpoint
 * (`sendSingleRequest` / `toStandardSingleResponse`, generic
 * `TRawSingleResponse`) — plus `type` and `maxBatchSize`. Every provider is
 * required to translate both of its own raw shapes into the same
 * `StandardEnrichmentResponse`; only how it gets there differs.
 *
 * The single-domain path isn't a parallel, unused feature: whenever a batch
 * shrinks to exactly one domain — the last item of an adaptive split, or a
 * caller handing `resolveBatch` just one domain — that domain goes through
 * the single endpoint instead of a batch-of-one, since that's what the
 * endpoint is for.
 *
 * Splitting a full domain list into `batchSize`-sized chunks and capping how
 * many chunks run concurrently is deliberately *not* done here —
 * `EnrichmentService` owns that, since it's identical across every provider
 * and doesn't belong duplicated into each one. This class only resolves
 * whatever single batch it's handed.
 */
export abstract class BaseHttpEnrichmentProvider<
  TRawBatchResponse = unknown,
  TRawSingleResponse = unknown,
> implements EnrichmentProvider {
  protected readonly logger = new Logger(this.constructor.name);

  abstract readonly type: ProviderType;

  /** Hard ceiling the provider's own API enforces per batch call — not a tuning knob. */
  protected abstract readonly maxBatchSize: number;

  constructor(protected readonly config: EnrichmentProviderConfig) {}

  /** @inheritdoc */
  get batchSize(): number {
    return Math.max(1, Math.min(this.config.batchSize, this.maxBatchSize));
  }

  /** @inheritdoc */
  get concurrencyThreshold(): number {
    return this.config.concurrencyThreshold;
  }

  /**
   * Call the provider's batch endpoint for exactly this set of domains
   * (already sized at or under `maxBatchSize`, and always more than one —
   * see class docs) and return its response exactly as that provider sends
   * it — no translation here. Throw `RetryableProviderError` for
   * whole-request failures (429/5xx/network); a malformed-but-successful
   * response should also throw, since there's nothing meaningful to
   * transform.
   */
  protected abstract sendBatchRequest(
    domains: string[],
  ): Promise<TRawBatchResponse>;

  /**
   * Transform the provider's raw batch response into the standard,
   * provider-agnostic shape. Pure translation — no I/O, no throwing on
   * business outcomes (a per-domain "no match" is a normal, well-formed item
   * here, not an error).
   */
  protected abstract toStandardBatchResponses(
    raw: TRawBatchResponse,
  ): StandardEnrichmentResponse[];

  /**
   * Call the provider's single-domain endpoint. Throw
   * `RetryableProviderError` for failures that mean "the request itself
   * didn't go through" (429, network error, an unparseable 5xx) — but if the
   * provider returns a well-formed per-domain error (e.g. a recognized
   * transient-failure body, however it signals that), return it normally so
   * `toStandardSingleResponse` can mark it `retryable` and let it flow
   * through the same retry-and-requeue loop batch items use. Only genuine
   * transport-level failures should throw here.
   */
  protected abstract sendSingleRequest(
    domain: string,
  ): Promise<TRawSingleResponse>;

  /** Transform the provider's raw single-domain response into the standard shape. */
  protected abstract toStandardSingleResponse(
    raw: TRawSingleResponse,
  ): StandardEnrichmentResponse;

  /**
   * Calls the provider and transforms its raw response into the standard
   * shape, in one step — routing to the single-domain endpoint when there's
   * only one domain left to resolve, and the batch endpoint otherwise.
   */
  private async fetchStandardResponses(
    domains: string[],
  ): Promise<StandardEnrichmentResponse[]> {
    if (domains.length === 1) {
      const raw = await this.sendSingleRequest(domains[0]);
      return [this.toStandardSingleResponse(raw)];
    }
    const raw = await this.sendBatchRequest(domains);
    return this.toStandardBatchResponses(raw);
  }

  /** @inheritdoc */
  async resolveBatch(domains: string[]): Promise<BatchResolution> {
    const resolved = new Map<string, ResolvedOutcome>();
    let remaining = domains;
    let attempt = 0;
    let retries = 0;

    while (remaining.length > 0 && attempt <= this.config.maxRetries) {
      if (attempt > 0) {
        retries += 1;
        this.logger.log(
          `retry round ${attempt}/${this.config.maxRetries} for ${remaining.length} domain(s) still marked retryable`,
        );
      }

      let result: { responses: StandardEnrichmentResponse[]; retries: number };
      try {
        result = await this.fetchResilient(remaining);
      } catch (err) {
        for (const domain of remaining) {
          resolved.set(domain, {
            status: 'failed',
            reason: 'PROVIDER_ERROR',
            message: (err as Error).message,
          });
        }
        remaining = [];
        break;
      }
      retries += result.retries;

      const nextRemaining: string[] = [];
      for (const item of result.responses) {
        if (item.status === 'ok' && item.data) {
          resolved.set(item.domain, { status: 'ok', data: item.data });
        } else if (item.retryable) {
          nextRemaining.push(item.domain);
        } else if (item.code === 'UNAUTHORIZED') {
          resolved.set(item.domain, {
            status: 'failed',
            reason: 'UNAUTHORIZED',
            message: item.message,
          });
        } else {
          resolved.set(item.domain, {
            status: 'failed',
            reason: item.code === 'NO_MATCH' ? 'NO_MATCH' : 'PROVIDER_ERROR',
            message: item.message,
          });
        }
      }

      remaining = nextRemaining;
      attempt += 1;
      if (remaining.length > 0 && attempt <= this.config.maxRetries) {
        await sleep(200 * 2 ** (attempt - 1));
      }
    }

    for (const domain of remaining) {
      resolved.set(domain, {
        status: 'failed',
        reason: 'TEMPORARY_EXHAUSTED',
        message: `still failing after ${this.config.maxRetries} retries`,
      });
    }

    return { outcomes: resolved, retries };
  }

  /**
   * A couple of quick retries at the requested size; if the provider keeps
   * rejecting the whole request even after those (429/network/unparseable
   * 5xx — see `sendBatchRequest`/`sendSingleRequest` docs), halves the batch
   * and resolves the two halves **sequentially**, not concurrently. This
   * keeps at most one HTTP request in flight per `resolveBatch` call
   * regardless of internal splitting — `EnrichmentService` caps how many
   * `resolveBatch` calls run at once assuming each one only ever holds a
   * single request in flight; splitting via `Promise.all` here would let
   * one call's internal fan-out silently exceed that cap. A single domain
   * (`domains.length === 1`) can't be split further; it just exhausts its
   * quick retries and propagates.
   */
  private async fetchResilient(
    domains: string[],
    depth = 0,
  ): Promise<{ responses: StandardEnrichmentResponse[]; retries: number }> {
    let retries = 0;
    try {
      const responses = await withRetry(
        () => this.fetchStandardResponses(domains),
        {
          maxRetries: 2,
          onRetry: (attempt, err, delayMs) => {
            retries += 1;
            this.logger.log(
              `quick retry ${attempt}/2 for a ${domains.length}-domain request after "${err.message}" — waiting ${Math.round(delayMs)}ms`,
            );
          },
        },
      );
      return { responses, retries };
    } catch (err) {
      if (
        err instanceof RetryableProviderError &&
        domains.length > 1 &&
        depth < 6
      ) {
        this.logger.warn(
          `provider request for ${domains.length} domain(s) still rejected after quick retries — retrying as smaller requests (this is an internal split inside one EnrichmentService batch, not a batch failure)`,
        );
        const mid = Math.ceil(domains.length / 2);
        const left = await this.fetchResilient(
          domains.slice(0, mid),
          depth + 1,
        );
        const right = await this.fetchResilient(domains.slice(mid), depth + 1);
        return {
          responses: [...left.responses, ...right.responses],
          retries: retries + left.retries + right.retries,
        };
      }
      throw err;
    }
  }
}
