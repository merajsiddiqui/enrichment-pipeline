import { Module } from '@nestjs/common';
import { CsvDomainSourceService } from './csv-domain-source.service';

/**
 * Standalone module for domain-extraction concerns — currently just
 * `CsvDomainSourceService`. Separate from `EnrichmentModule` for the same
 * reason `ProvidersModule` is: "how domains are extracted from a source" is
 * a distinct concern from "orchestrating a run" or "resolving domains
 * through a provider," and both `EnrichmentController` and `CliModule`'s
 * `EnrichCommand` need this service independently of each other.
 */
@Module({
  providers: [CsvDomainSourceService],
  exports: [CsvDomainSourceService],
})
export class DomainSourcesModule {}
