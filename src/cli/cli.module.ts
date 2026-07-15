import { Module } from '@nestjs/common';
import { EnrichmentModule } from '../enrichment/enrichment.module';
import { DomainSourcesModule } from '../domain-sources/domain-sources.module';
import { EnrichCommand } from './enrich.command';

/**
 * Registers CLI commands. Imports `EnrichmentModule` (for
 * `EnrichmentRunnerService`) and `DomainSourcesModule` (for
 * `CsvDomainSourceService`) so `EnrichCommand` can inject both directly.
 */
@Module({
  imports: [EnrichmentModule, DomainSourcesModule],
  providers: [EnrichCommand],
})
export class CliModule {}
