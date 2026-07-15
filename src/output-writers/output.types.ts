import {
  EnrichedCompanyData,
  FailureReason,
} from '../providers/enrichment-provider.types';

/**
 * Shapes describing what gets persisted by an `OutputWriter` — kept here,
 * not in `src/enrichment/`, so `OutputWriter` implementations have no
 * dependency on the enrichment module; `EnrichmentRunnerService` depends on
 * these, not the other way around.
 */

/** Outcome of enriching a single input row. */
export type OutputStatus = 'ok' | 'failed';

/**
 * One persisted record, corresponding to exactly one input row (by original
 * row number and raw domain text) — every input row produces exactly one
 * output record, so nothing is silently dropped.
 */
export interface OutputRecord {
  row: number;
  domain: string;
  status: OutputStatus;
  reason?: FailureReason;
  message?: string;
  data?: EnrichedCompanyData;
}

/** Aggregate counts persisted alongside the output records, for an operator to act on. */
export interface RunSummary {
  /** A caller-supplied description of where the domains came from — a file path, a label, etc. Not necessarily a file path. */
  input: string;
  output: string;
  totalRows: number;
  uniqueDomains: number;
  succeeded: number;
  failed: number;
  failuresByReason: Record<string, number>;
  durationMs: number;
}
