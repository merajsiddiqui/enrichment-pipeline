import { BaseHttpEnrichmentProvider } from '../base-http-enrichment.provider';
import { RetryableProviderError } from '../../enrichment/util/retry.util';
import {
  ProviderType,
  StandardEnrichmentResponse,
} from '../enrichment-provider.types';
import { normalizeMockRecord } from './mock-enrichment-response.mapper';

/**
 * One domain's result exactly as the mock provider returns it — used both
 * for items inside a batch response and for the single-domain endpoint's
 * response body, since both share this shape (`starter-kit/API.md`).
 */
interface MockRawResultItem {
  domain: string;
  status: 'ok' | 'error';
  code?: string;
  message?: string;
  retryable?: boolean;
  data?: Record<string, unknown>;
}

/** The mock provider's raw `/v1/enrich/batch` response body, before any translation. */
interface MockRawBatchResponse {
  status: string;
  results?: MockRawResultItem[];
}

/**
 * Concrete provider for the take-home's mock enrichment API
 * (`starter-kit/mock-provider.js`, documented in `starter-kit/API.md`).
 * Owns everything specific to that API: both endpoint URLs, the required
 * auth/version headers, its documented batch size ceiling, and translating
 * its own raw v2 response schema (batch and single) into the standard
 * `StandardEnrichmentResponse` shape. Everything generic (retries,
 * concurrency, adaptive batch splitting, single-vs-batch routing) comes from
 * `BaseHttpEnrichmentProvider`.
 */
export class MockEnrichmentProvider extends BaseHttpEnrichmentProvider<
  MockRawBatchResponse,
  MockRawResultItem
> {
  readonly type = ProviderType.MOCK;

  /** API.md: "Enrich up to 25 domains in one call." */
  protected readonly maxBatchSize = 25;

  /** @inheritdoc */
  protected async sendBatchRequest(
    domains: string[],
  ): Promise<MockRawBatchResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let res: Response;
    try {
      res = await fetch(`${this.config.baseUrl}/v1/enrich/batch`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'X-Provider-Version': '2',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ domains }),
        signal: controller.signal,
      });
    } catch (err) {
      // Network error / timeout — API.md calls out slow responses and
      // transient unavailability explicitly, so this is retryable.
      throw new RetryableProviderError(
        `provider request failed: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (res.status === 401) {
      throw new Error('provider rejected auth token (401) — aborting run');
    }
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after'));
      throw new RetryableProviderError(
        'rate limited (429)',
        Number.isFinite(retryAfter) ? retryAfter : undefined,
      );
    }
    if (res.status >= 500) {
      throw new RetryableProviderError(`provider error (${res.status})`);
    }
    if (!res.ok) {
      throw new Error(`unexpected provider response: ${res.status}`);
    }

    // API.md: HTTP status alone isn't reliable for per-item outcomes inside
    // a batch — the body's top-level and per-item `status` fields are the
    // source of truth.
    const body = (await res.json()) as MockRawBatchResponse;
    if (body.status !== 'ok' || !Array.isArray(body.results)) {
      throw new Error(`malformed batch response: ${JSON.stringify(body)}`);
    }
    return body;
  }

  /** @inheritdoc */
  protected toStandardBatchResponses(
    raw: MockRawBatchResponse,
  ): StandardEnrichmentResponse[] {
    return (raw.results ?? []).map((item) => this.toStandardResponse(item));
  }

  /**
   * @inheritdoc
   *
   * Verified empirically (not assumed from the batch endpoint's behavior):
   * `GET /v1/enrich?domain=` returns a transient failure as HTTP 500 with a
   * well-formed `{status:"error", code:"TEMPORARY", retryable:true, ...}`
   * body — that's a per-domain outcome, not a broken request, so it's
   * returned normally rather than thrown. A 5xx with no parseable body of
   * that shape is treated as a genuine transport failure instead.
   */
  protected async sendSingleRequest(
    domain: string,
  ): Promise<MockRawResultItem> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let res: Response;
    try {
      res = await fetch(
        `${this.config.baseUrl}/v1/enrich?domain=${encodeURIComponent(domain)}`,
        {
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'X-Provider-Version': '2',
          },
          signal: controller.signal,
        },
      );
    } catch (err) {
      throw new RetryableProviderError(
        `provider request failed: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (res.status === 401) {
      throw new Error('provider rejected auth token (401) — aborting run');
    }
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after'));
      throw new RetryableProviderError(
        'rate limited (429)',
        Number.isFinite(retryAfter) ? retryAfter : undefined,
      );
    }

    if (res.status >= 500) {
      let body: MockRawResultItem | undefined;
      try {
        body = (await res.json()) as MockRawResultItem;
      } catch {
        // not a well-formed per-domain error body — fall through to throw
      }
      if (body?.status === 'error' && body.code) {
        return body;
      }
      throw new RetryableProviderError(`provider error (${res.status})`);
    }

    if (!res.ok) {
      throw new Error(`unexpected provider response: ${res.status}`);
    }

    return (await res.json()) as MockRawResultItem;
  }

  /** @inheritdoc */
  protected toStandardSingleResponse(
    raw: MockRawResultItem,
  ): StandardEnrichmentResponse {
    return this.toStandardResponse(raw);
  }

  private toStandardResponse(
    item: MockRawResultItem,
  ): StandardEnrichmentResponse {
    return {
      domain: item.domain,
      status: item.status,
      code: item.code,
      message: item.message,
      retryable: item.retryable,
      data:
        item.status === 'ok' && item.data
          ? normalizeMockRecord(item.domain, item.data)
          : undefined,
    };
  }
}
