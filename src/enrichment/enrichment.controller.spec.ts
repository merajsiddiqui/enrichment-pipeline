import { BadRequestException } from '@nestjs/common';

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  mkdirSync: jest.fn(),
}));
jest.mock('../output-writers/jsonl-output-writer');
jest.mock('../outcome-store/outcome-store.factory');

import { EnrichmentController } from './enrichment.controller';
import { EnrichmentRunnerService } from './enrichment-runner.service';
import { CsvDomainSourceService } from '../domain-sources/csv-domain-source.service';
import { JsonlOutputWriter } from '../output-writers/jsonl-output-writer';
import { createOutcomeStore } from '../outcome-store/outcome-store.factory';
import { ProviderType } from '../providers/enrichment-provider.types';

describe('EnrichmentController', () => {
  let enrichmentRunner: jest.Mocked<EnrichmentRunnerService>;
  let csvDomainSource: jest.Mocked<CsvDomainSourceService>;
  let controller: EnrichmentController;

  beforeEach(() => {
    jest.clearAllMocks();
    enrichmentRunner = {
      run: jest.fn().mockResolvedValue({
        input: 'x',
        output: 'y',
        totalRows: 0,
        uniqueDomains: 0,
        succeeded: 0,
        failed: 0,
        failuresByReason: {},
        durationMs: 0,
      }),
    } as unknown as jest.Mocked<EnrichmentRunnerService>;
    csvDomainSource = {
      extractDomains: jest.fn().mockReturnValue((async function* () {})()),
    };
    controller = new EnrichmentController(enrichmentRunner, csvDomainSource);
    (createOutcomeStore as jest.Mock).mockReturnValue({
      has: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
      close: jest.fn(),
    });
  });

  describe('enrichFromCsv', () => {
    const file = {
      path: '/tmp/upload/input.csv',
      destination: '/tmp/upload',
      originalname: 'domains.csv',
    } as Express.Multer.File;

    it('rejects with BadRequestException when no file is uploaded', async () => {
      await expect(
        controller.enrichFromCsv(undefined as never, {}),
      ).rejects.toThrow(BadRequestException);
      expect(enrichmentRunner.run).not.toHaveBeenCalled();
    });

    it('extracts domains from the uploaded file and runs with a JSONL writer + outcome store', async () => {
      await controller.enrichFromCsv(file, {});

      expect(csvDomainSource.extractDomains).toHaveBeenCalledWith(file.path);
      expect(JsonlOutputWriter).toHaveBeenCalledWith(
        '/tmp/upload/output.jsonl',
      );
      expect(createOutcomeStore).toHaveBeenCalledTimes(1);
      expect(enrichmentRunner.run).toHaveBeenCalledWith(
        expect.objectContaining({
          inputLabel: 'domains.csv',
          providerType: ProviderType.MOCK,
        }),
      );
    });

    it('defaults providerType to MOCK when body.provider is not given', async () => {
      await controller.enrichFromCsv(file, {});
      const arg = enrichmentRunner.run.mock.calls[0][0];
      expect(arg.providerType).toBe(ProviderType.MOCK);
    });

    it('rejects an unrecognized provider name with BadRequestException', async () => {
      await expect(
        controller.enrichFromCsv(file, { provider: 'bogus' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('coerces numeric-looking string tuning fields to numbers, and blanks to undefined', async () => {
      await controller.enrichFromCsv(file, {
        apiKey: 'k',
        providerUrl: 'http://x',
        concurrency: '5',
        maxRetries: '',
        batchSize: 10,
      });

      const arg = enrichmentRunner.run.mock.calls[0][0];
      expect(arg.providerConfig).toEqual({
        apiKey: 'k',
        baseUrl: 'http://x',
        concurrencyThreshold: 5,
        maxRetries: undefined,
        batchSize: 10,
      });
    });
  });

  describe('enrichFromDomains', () => {
    it('rejects with BadRequestException when domains is missing', async () => {
      await expect(controller.enrichFromDomains({})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects with BadRequestException when domains is an empty array', async () => {
      await expect(
        controller.enrichFromDomains({ domains: [] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects with BadRequestException when domains is not an array', async () => {
      await expect(
        controller.enrichFromDomains({ domains: 'a.com' as never }),
      ).rejects.toThrow(BadRequestException);
    });

    it('runs with a descriptive inputLabel including the domain count', async () => {
      await controller.enrichFromDomains({ domains: ['a.com', 'b.com'] });

      const arg = enrichmentRunner.run.mock.calls[0][0];
      expect(arg.inputLabel).toBe('json (2 domains)');
    });

    it('constructs a JsonlOutputWriter and an outcome store for the run', async () => {
      await controller.enrichFromDomains({ domains: ['a.com'] });
      expect(JsonlOutputWriter).toHaveBeenCalledTimes(1);
      expect(createOutcomeStore).toHaveBeenCalledTimes(1);
    });
  });
});
