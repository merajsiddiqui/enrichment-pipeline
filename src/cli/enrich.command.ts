import { Command, CommandRunner, Option } from 'nest-commander';
import { EnrichmentRunnerService } from '../enrichment/enrichment-runner.service';
import { CsvDomainSourceService } from '../domain-sources/csv-domain-source.service';
import { JsonlOutputWriter } from '../output-writers/jsonl-output-writer';
import { BatchProgress } from '../enrichment/enrichment.types';
import { createOutcomeStore } from '../outcome-store/outcome-store.factory';

/** Parsed shape of this command's CLI flags (see the `@Option` handlers below). */
interface EnrichCommandOptions {
  input: string;
  output: string;
}

/**
 * `enrich` CLI command: reads a CSV of domains and enriches each through the
 * default provider, via the same `EnrichmentRunnerService` the HTTP API
 * uses. This command owns everything specific to being a CLI: extracting
 * domains from the CSV file (`CsvDomainSourceService`) and choosing/
 * constructing the output writer (`JsonlOutputWriter`) and outcome store
 * (`createOutcomeStore` — in-memory or file-backed, per
 * `ENRICHMENT_OUTCOME_STORE`).
 *
 * No provider configuration is accepted here — which provider to use and
 * how it's tuned (API key, batch size, concurrency, retries) always comes
 * from environment variables (`DEFAULT_ENRICHMENT_PROVIDER` plus that
 * provider's own `*_` env vars — see `EnrichmentService`/
 * `EnrichmentProviderManager`), so the same command behaves identically
 * wherever it's run.
 */
@Command({
  name: 'enrich',
  description:
    'Read a CSV of domains (column "domain") and enrich each via the default provider',
})
export class EnrichCommand extends CommandRunner {
  constructor(
    private readonly enrichmentRunner: EnrichmentRunnerService,
    private readonly csvDomainSource: CsvDomainSourceService,
  ) {
    super();
  }

  /** Entry point nest-commander invokes with the parsed options. */
  async run(
    _passedParams: string[],
    options: EnrichCommandOptions,
  ): Promise<void> {
    // Per-batch visibility is a CLI-only diagnostic: `EnrichmentService`
    // only reports progress if handed a callback, and this is the one
    // place that supplies one — the HTTP API doesn't, so a request's
    // batches never get logged to the server console.
    const batches: BatchProgress[] = [];
    const summary = await this.enrichmentRunner.run({
      domains: this.csvDomainSource.extractDomains(options.input),
      outputWriter: new JsonlOutputWriter(options.output),
      outcomeStore: createOutcomeStore(),
      inputLabel: options.input,
      onBatchResolved: (progress) => {
        batches.push(progress);
        console.log(
          `sending batch ${progress.batchIndex} of ${progress.totalBatches} ` +
            `(${progress.size} domain${progress.size === 1 ? '' : 's'}) — ` +
            `${progress.succeeded} succeeded, ${progress.failed} failed, ` +
            `${progress.retries} retr${progress.retries === 1 ? 'y' : 'ies'}`,
        );
      },
    });

    console.log(JSON.stringify(summary, null, 2));

    const batchDomains = batches.reduce((sum, b) => sum + b.size, 0);
    batches.sort((a, b) => a.batchIndex - b.batchIndex);
    console.log(
      `\nBatch breakdown — ${batchDomains} unique domain(s) actually sent to the ` +
        `provider (summary counts above are per input row: they also include ` +
        `${summary.totalRows - batchDomains} duplicate/invalid row(s) resolved ` +
        `without a provider call, which is why they don't sum to the same totals):`,
    );
    console.table(
      batches.map((b) => ({
        batch: `${b.batchIndex}/${b.totalBatches}`,
        size: b.size,
        succeeded: b.succeeded,
        failed: b.failed,
        retries: b.retries,
      })),
    );
  }

  @Option({
    flags: '-i, --input <path>',
    description: 'Path to input CSV with a "domain" column',
    required: true,
  })
  parseInput(val: string): string {
    return val;
  }

  @Option({
    flags: '-o, --output <path>',
    description: 'Path to write enriched output as JSONL',
    required: true,
  })
  parseOutput(val: string): string {
    return val;
  }
}
