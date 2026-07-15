import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { EnrichmentRunnerService } from './enrichment-runner.service';
import { CsvDomainSourceService } from '../domain-sources/csv-domain-source.service';
import { domainsFromArray } from '../domain-sources/json-domain-source';
import { JsonlOutputWriter } from '../output-writers/jsonl-output-writer';
import {
  EnrichmentProviderConfig,
  ProviderType,
} from '../providers/enrichment-provider.types';
import { RunSummary } from '../output-writers/output.types';
import { createOutcomeStore } from '../outcome-store/outcome-store.factory';

/** Provider tuning fields shared by both endpoints below (arrives as strings from multipart form fields, or as their native JSON types from the domains endpoint). */
interface ProviderTuningFields {
  provider?: string;
  apiKey?: string;
  providerUrl?: string;
  concurrency?: number | string;
  maxRetries?: number | string;
  batchSize?: number | string;
}

/** JSON body for `POST /enrichments/domains`. */
interface EnrichDomainsRequestBody extends ProviderTuningFields {
  domains?: string[];
}

const RUNS_DIR = join(process.cwd(), 'runs');

/**
 * Thin HTTP wrapper over `EnrichmentRunnerService` — the same core the CLI
 * uses, so this controller does no enrichment logic of its own, only
 * request plumbing: extracting domains from whichever source this endpoint
 * implies (`CsvDomainSourceService` for the upload endpoint, a plain array
 * for the JSON one) and constructing the output writer
 * (`JsonlOutputWriter`) — the runner itself knows about neither.
 *
 * A synchronous request/response isn't the right shape for a true
 * 100k-row run over HTTP (the client would hold the connection open for the
 * whole run); these endpoints are intended for modest inputs and smoke tests.
 * See DECISIONS.md for the async/job-queue alternative this doesn't build.
 */
@Controller('enrichments')
export class EnrichmentController {
  constructor(
    private readonly enrichmentRunner: EnrichmentRunnerService,
    private readonly csvDomainSource: CsvDomainSourceService,
  ) {}

  /** Enrich a CSV file with a `domain` column, uploaded as multipart/form-data. */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = join(RUNS_DIR, String(Date.now()));
          mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, _file, cb) => cb(null, 'input.csv'),
      }),
    }),
  )
  async enrichFromCsv(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: ProviderTuningFields,
  ): Promise<RunSummary> {
    if (!file) {
      throw new BadRequestException('multipart field "file" (CSV) is required');
    }
    return this.enrichmentRunner.run({
      domains: this.csvDomainSource.extractDomains(file.path),
      outputWriter: new JsonlOutputWriter(
        join(file.destination, 'output.jsonl'),
      ),
      outcomeStore: createOutcomeStore(),
      inputLabel: file.originalname,
      providerType: this.parseProviderType(body.provider),
      providerConfig: this.buildProviderConfig(body),
    });
  }

  /** Enrich a plain JSON array of domains — no CSV involved. */
  @Post('domains')
  async enrichFromDomains(
    @Body() body: EnrichDomainsRequestBody,
  ): Promise<RunSummary> {
    if (!Array.isArray(body.domains) || body.domains.length === 0) {
      throw new BadRequestException(
        '"domains" must be a non-empty array of strings',
      );
    }
    const runDir = join(RUNS_DIR, String(Date.now()));
    mkdirSync(runDir, { recursive: true });

    return this.enrichmentRunner.run({
      domains: domainsFromArray(body.domains),
      outputWriter: new JsonlOutputWriter(join(runDir, 'output.jsonl')),
      outcomeStore: createOutcomeStore(),
      inputLabel: `json (${body.domains.length} domains)`,
      providerType: this.parseProviderType(body.provider),
      providerConfig: this.buildProviderConfig(body),
    });
  }

  private buildProviderConfig(
    fields: ProviderTuningFields,
  ): Partial<EnrichmentProviderConfig> {
    return {
      apiKey: fields.apiKey,
      baseUrl: fields.providerUrl,
      concurrencyThreshold: this.toNumber(fields.concurrency),
      maxRetries: this.toNumber(fields.maxRetries),
      batchSize: this.toNumber(fields.batchSize),
    };
  }

  private toNumber(value: number | string | undefined): number | undefined {
    if (value === undefined || value === '') return undefined;
    return typeof value === 'number' ? value : Number(value);
  }

  private parseProviderType(value: string | undefined): ProviderType {
    if (!value) return ProviderType.MOCK;
    if (!Object.values(ProviderType).includes(value as ProviderType)) {
      throw new BadRequestException(
        `unknown provider "${value}" — expected one of: ${Object.values(ProviderType).join(', ')}`,
      );
    }
    return value as ProviderType;
  }
}
