import { OutputRecord, RunSummary } from './output.types';

/**
 * Contract for persisting one enrichment run's results. The CLI/API layers
 * construct whichever implementation they want (JSONL today; CSV is a
 * plausible future one) and hand it to `EnrichmentRunnerService` — the
 * runner drives it, but never decides which format is used or how it's
 * written. That decision belongs to whoever is closest to "what output was
 * actually requested" (a CLI flag, a request field), not to the pipeline.
 */
export interface OutputWriter {
  /**
   * Human-readable description of where this writer persists to (e.g. a
   * file path) — the runner records this in `RunSummary.output` without
   * needing to know the writer's destination itself.
   */
  readonly description: string;

  /** Persist one output record. Called once per input row, in whatever order the pipeline resolves them. */
  writeRecord(record: OutputRecord): void;

  /** Flush/close the output and persist the run summary. Called exactly once, after every record has been written. */
  finalize(summary: RunSummary): Promise<void>;
}
