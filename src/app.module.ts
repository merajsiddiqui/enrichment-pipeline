import { Module } from '@nestjs/common';
import { EnrichmentModule } from './enrichment/enrichment.module';
import { CliModule } from './cli/cli.module';

/**
 * Root module. Bootstrapped by both entry points — `main.ts` (HTTP API via
 * `NestFactory`) and `cli.ts` (CLI via `nest-commander`'s `CommandFactory`)
 * — so `EnrichmentModule`'s `EnrichmentService` and provider graph are
 * shared identically between the two front ends. Declares no controllers or
 * providers of its own; every route/service lives in a feature module.
 */
@Module({
  imports: [EnrichmentModule, CliModule],
})
export class AppModule {}
