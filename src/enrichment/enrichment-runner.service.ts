import { Injectable, Logger } from '@nestjs/common';
import { InputRow } from '../domain-sources/domain-source.types';
import { isValidDomain, normalizeDomain } from './util/domain-validation.util';
import { ResolvedOutcome } from '../providers/enrichment-provider.types';
import { OutputRecord, RunSummary } from '../output-writers/output.types';
import { EnrichmentRunOptions } from './enrichment.types';
import { EnrichmentService } from './enrichment.service';

/**
 * Coordinates one full enrichment run end to end, and nothing more: reads
 * every row from the caller-supplied domain source, hands the deduplicated,
 * valid domains to `EnrichmentService` in a single call, then correlates the
 * results — read back from the caller-supplied `ResolvedOutcomeStore` — to
 * every original input row (including duplicates and invalid entries — no
 * input row is ever dropped) and drives the caller-supplied `OutputWriter`.
 *
 * This is the one piece of shared logic between the CLI and the HTTP API —
 * everything upstream (how domains were extracted) and downstream (how/where
 * output is persisted, where results are held) is the caller's
 * responsibility, not this class's. Deciding which provider to use, and how
 * to batch/merge calls to it, is `EnrichmentService`'s responsibility, not
 * this class's either.
 */
@Injectable()
export class EnrichmentRunnerService {
  private readonly logger = new Logger(EnrichmentRunnerService.name);

  constructor(private readonly enrichmentService: EnrichmentService) {}

  /** Runs one full enrichment pass; resolves once every record has been written and the writer is finalized. */
  async run(options: EnrichmentRunOptions): Promise<RunSummary> {
    const startedAt = Date.now();

    // One pass over the source to collect every row (so every input row can
    // be correlated to an outcome afterwards, including duplicates) and the
    // set of valid, normalized, unique domains actually worth a provider
    // call. The source (CSV, JSON array, whatever) is read to completion
    // here — `EnrichmentService` is called once with the full list rather
    // than once per page.
    const rows: InputRow[] = [];
    const uniqueDomains = new Set<string>();
    for await (const row of options.domains) {
      rows.push(row);
      if (isValidDomain(row.raw)) {
        uniqueDomains.add(normalizeDomain(row.raw));
      }
    }

    try {
      await this.enrichmentService.enrich(
        [...uniqueDomains],
        options.outcomeStore,
        options.providerType,
        options.providerConfig,
        options.onBatchResolved,
      );

      const summary: RunSummary = {
        input: options.inputLabel ?? '(unlabeled)',
        output: options.outputWriter.description,
        totalRows: 0,
        uniqueDomains: uniqueDomains.size,
        succeeded: 0,
        failed: 0,
        failuresByReason: {},
        durationMs: 0,
      };

      for (const row of rows) {
        summary.totalRows += 1;
        // Safe to assert: every valid domain was added to `uniqueDomains`
        // before calling `enrich`, which guarantees one outcome was stored
        // for every domain in.
        const outcome: ResolvedOutcome = isValidDomain(row.raw)
          ? (await options.outcomeStore.get(normalizeDomain(row.raw)))!
          : {
              status: 'failed',
              reason: 'INVALID_DOMAIN',
              message: `"${row.raw}" is not a well-formed domain`,
            };

        const record: OutputRecord =
          outcome.status === 'ok'
            ? {
                row: row.row,
                domain: row.raw,
                status: 'ok',
                data: outcome.data,
              }
            : {
                row: row.row,
                domain: row.raw,
                status: 'failed',
                reason: outcome.reason,
                message: outcome.message,
              };
        options.outputWriter.writeRecord(record);

        if (outcome.status === 'ok') {
          summary.succeeded += 1;
        } else {
          summary.failed += 1;
          summary.failuresByReason[outcome.reason] =
            (summary.failuresByReason[outcome.reason] ?? 0) + 1;
        }
        if (summary.totalRows % 1000 === 0) {
          this.logger.log(`processed ${summary.totalRows} rows...`);
        }
      }

      summary.durationMs = Date.now() - startedAt;

      await options.outputWriter.finalize(summary);
      return summary;
    } finally {
      // Always released, including on failure — a FileOutcomeStore holds an
      // open file handle and a temp file on disk that must not leak.
      await options.outcomeStore.close();
    }
  }
}
