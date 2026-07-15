import { Module } from '@nestjs/common';
import { EnrichmentProviderManager } from './enrichment-provider-manager.service';

/**
 * Standalone module for the enrichment-provider layer (the `EnrichmentProvider`
 * interface, concrete providers, and the `EnrichmentProviderManager` factory
 * that resolves a `ProviderType` to one of them). Deliberately separate from
 * `EnrichmentModule` — providers are a distinct concern (talking to external
 * data vendors) from enrichment orchestration (reading input, deduping,
 * writing output), and this separation is what makes `EnrichmentService`'s
 * dependency on `EnrichmentProviderManager` an import across module
 * boundaries rather than an implicit same-folder coupling.
 */
@Module({
  providers: [EnrichmentProviderManager],
  exports: [EnrichmentProviderManager],
})
export class ProvidersModule {}
