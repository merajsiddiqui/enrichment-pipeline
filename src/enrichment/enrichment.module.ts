import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module';
import { DomainSourcesModule } from '../domain-sources/domain-sources.module';
import { EnrichmentService } from './enrichment.service';
import { EnrichmentRunnerService } from './enrichment-runner.service';
import { EnrichmentController } from './enrichment.controller';

/**
 * Wires the enrichment feature: the HTTP controller, `EnrichmentService`
 * (picks a provider, batches, calls it, merges the results), and
 * `EnrichmentRunnerService` (extracts input, calls `EnrichmentService` once,
 * correlates the merged result back to every row, drives the writer).
 * Imports `ProvidersModule` (provider resolution, used by `EnrichmentService`)
 * and `DomainSourcesModule` (CSV extraction) rather than declaring those
 * concerns itself — each lives in its own module because each is a distinct
 * responsibility from "orchestrating an enrichment run." Exports
 * `EnrichmentRunnerService` so `CliModule` can reuse the exact same
 * instance/graph for the CLI entry point.
 */
@Module({
  imports: [ProvidersModule, DomainSourcesModule],
  controllers: [EnrichmentController],
  providers: [EnrichmentService, EnrichmentRunnerService],
  exports: [EnrichmentRunnerService],
})
export class EnrichmentModule {}
