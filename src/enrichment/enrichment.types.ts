import {
  EnrichmentProviderConfig,
  ProviderType,
} from '../providers/enrichment-provider.types';
import { InputRow } from '../domain-sources/domain-source.types';
import { OutputWriter } from '../output-writers/output-writer.interface';
import { ResolvedOutcomeStore } from '../outcome-store/resolved-outcome-store.interface';

export type { ResolvedOutcome } from '../providers/enrichment-provider.types';
export type {
  OutputStatus,
  OutputRecord,
  RunSummary,
} from '../output-writers/output.types';

/** Reported once per outer batch by `EnrichmentService.enrich`'s optional `onBatchResolved` hook — see there for when/why it fires. */
export interface BatchProgress {
  /** 1-based position of this batch among all batches this `enrich` call made. */
  batchIndex: number;
  totalBatches: number;
  /** Domains this batch was sent with. */
  size: number;
  succeeded: number;
  failed: number;
  /** Total retry attempts this batch needed (see `BatchResolution.retries`) — 0 means it resolved on the first attempt. */
  retries: number;
}

/**
 * Input to `EnrichmentRunnerService.run` — the CLI and the HTTP API both
 * build one of these. `domains` accepts a sync or async iterable of
 * `InputRow`: the runner has no idea and doesn't care whether it came from a
 * CSV file (an async stream) or a JSON request body (a plain in-memory
 * array) — extracting domains from a specific source is the caller's job
 * (see `src/domain-sources/`).
 *
 * `outputWriter` is likewise supplied by the caller, not decided by the
 * runner: whether output goes to JSONL, CSV, or anything else is a decision
 * that belongs to whoever knows what was actually requested (a CLI flag, a
 * request field) — see `src/output-writers/`.
 *
 * `outcomeStore` follows the same reasoning: whether a run's resolved
 * outcomes are held in memory or spilled to disk is an infrastructure
 * choice the caller makes (see `createOutcomeStore`), not something the
 * runner or `EnrichmentService` decides for itself.
 */
export interface EnrichmentRunOptions {
  domains: AsyncIterable<InputRow> | Iterable<InputRow>;
  outputWriter: OutputWriter;
  outcomeStore: ResolvedOutcomeStore;
  /**
   * Human-readable label for where `domains` came from, recorded verbatim
   * in `RunSummary.input` — e.g. a file path or `"json (12 domains)"`.
   * Purely descriptive; the runner never inspects it.
   */
  inputLabel?: string;
  /** Which provider to enrich through. Defaults to `ProviderType.MOCK`. */
  providerType?: ProviderType;
  /**
   * Per-run overrides layered over that provider's environment-based
   * defaults (see `EnrichmentProviderManager`) — e.g. an API-supplied batch
   * size (the CLI never supplies these; it has no provider flags). Passed
   * through opaquely; never inspected field-by-field, keeping the runner
   * independent of what any given provider's config actually contains.
   */
  providerConfig?: Partial<EnrichmentProviderConfig>;
  /** Optional per-batch progress hook, forwarded as-is to `EnrichmentService.enrich`. Only the CLI supplies one; the API doesn't. */
  onBatchResolved?: (progress: BatchProgress) => void;
}
