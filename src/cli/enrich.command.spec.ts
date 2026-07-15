jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  mkdirSync: jest.fn(),
  createWriteStream: jest.fn(() => ({
    write: jest.fn(),
    end: jest.fn((cb?: (err?: Error | null) => void) => cb?.(null)),
  })),
}));
jest.mock('../outcome-store/outcome-store.factory');

import { EnrichCommand } from './enrich.command';
import { EnrichmentRunnerService } from '../enrichment/enrichment-runner.service';
import { CsvDomainSourceService } from '../domain-sources/csv-domain-source.service';
import { createOutcomeStore } from '../outcome-store/outcome-store.factory';
import { RunSummary } from '../output-writers/output.types';

describe('EnrichCommand', () => {
  let enrichmentRunner: jest.Mocked<EnrichmentRunnerService>;
  let csvDomainSource: jest.Mocked<CsvDomainSourceService>;
  let command: EnrichCommand;
  let consoleLogSpy: jest.SpyInstance;
  let consoleTableSpy: jest.SpyInstance;

  const summary: RunSummary = {
    input: 'in.csv',
    output: 'out.jsonl',
    totalRows: 3,
    uniqueDomains: 2,
    succeeded: 2,
    failed: 1,
    failuresByReason: { INVALID_DOMAIN: 1 },
    durationMs: 42,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    enrichmentRunner = {
      run: jest.fn().mockResolvedValue(summary),
    } as unknown as jest.Mocked<EnrichmentRunnerService>;
    csvDomainSource = {
      extractDomains: jest.fn().mockReturnValue((async function* () {})()),
    };
    (createOutcomeStore as jest.Mock).mockReturnValue({
      has: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
      close: jest.fn(),
    });
    command = new EnrichCommand(enrichmentRunner, csvDomainSource);
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleTableSpy = jest.spyOn(console, 'table').mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleTableSpy.mockRestore();
  });

  it('extracts domains from --input and passes them to the runner along with an output writer and outcome store', async () => {
    await command.run([], { input: 'in.csv', output: 'out.jsonl' });

    expect(csvDomainSource.extractDomains).toHaveBeenCalledWith('in.csv');
    expect(createOutcomeStore).toHaveBeenCalledTimes(1);
    const arg = enrichmentRunner.run.mock.calls[0][0];
    expect(arg.inputLabel).toBe('in.csv');
    expect(arg.outputWriter).toBeDefined();
    expect(arg.outcomeStore).toBeDefined();
  });

  it('does not pass any providerType/providerConfig — the CLI has no provider flags', async () => {
    await command.run([], { input: 'in.csv', output: 'out.jsonl' });

    const arg = enrichmentRunner.run.mock.calls[0][0];
    expect(arg.providerType).toBeUndefined();
    expect(arg.providerConfig).toBeUndefined();
  });

  it('prints the run summary as JSON', async () => {
    await command.run([], { input: 'in.csv', output: 'out.jsonl' });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify(summary, null, 2),
    );
  });

  it('logs a per-batch line and renders a batch-breakdown table from onBatchResolved callbacks', async () => {
    enrichmentRunner.run.mockImplementation(async (options) => {
      options.onBatchResolved?.({
        batchIndex: 1,
        totalBatches: 2,
        size: 25,
        succeeded: 24,
        failed: 1,
        retries: 3,
      });
      options.onBatchResolved?.({
        batchIndex: 2,
        totalBatches: 2,
        size: 11,
        succeeded: 10,
        failed: 1,
        retries: 1,
      });
      return summary;
    });

    await command.run([], { input: 'in.csv', output: 'out.jsonl' });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('sending batch 1 of 2'),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('sending batch 2 of 2'),
    );
    expect(consoleTableSpy).toHaveBeenCalledWith([
      { batch: '1/2', size: 25, succeeded: 24, failed: 1, retries: 3 },
      { batch: '2/2', size: 11, succeeded: 10, failed: 1, retries: 1 },
    ]);
  });

  it('sorts the batch breakdown table by batch index even if callbacks arrive out of order', async () => {
    enrichmentRunner.run.mockImplementation(async (options) => {
      options.onBatchResolved?.({
        batchIndex: 2,
        totalBatches: 2,
        size: 5,
        succeeded: 5,
        failed: 0,
        retries: 0,
      });
      options.onBatchResolved?.({
        batchIndex: 1,
        totalBatches: 2,
        size: 5,
        succeeded: 5,
        failed: 0,
        retries: 0,
      });
      return summary;
    });

    await command.run([], { input: 'in.csv', output: 'out.jsonl' });

    const tableArg = consoleTableSpy.mock.calls[0][0];
    expect(tableArg.map((r: { batch: string }) => r.batch)).toEqual([
      '1/2',
      '2/2',
    ]);
  });
});
