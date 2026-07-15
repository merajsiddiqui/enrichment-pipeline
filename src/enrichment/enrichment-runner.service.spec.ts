import { EnrichmentRunnerService } from './enrichment-runner.service';
import { EnrichmentService } from './enrichment.service';
import { OutputWriter } from '../output-writers/output-writer.interface';
import { OutputRecord, RunSummary } from '../output-writers/output.types';
import { ResolvedOutcomeStore } from '../outcome-store/resolved-outcome-store.interface';
import { ResolvedOutcome } from '../providers/enrichment-provider.types';
import { InputRow } from '../domain-sources/domain-source.types';

function ok(domain: string): ResolvedOutcome {
  return {
    status: 'ok',
    data: {
      domain,
      name: 'Co',
      employeeCount: 1,
      employeeCountRaw: 1,
      industry: [],
      location: { city: null, country: null },
      foundedYear: null,
      annualRevenueUsd: null,
    },
  };
}

function fakeOutputWriter(): jest.Mocked<OutputWriter> {
  return {
    description: 'test-output',
    writeRecord: jest.fn(),
    finalize: jest.fn().mockResolvedValue(undefined),
  };
}

function fakeStore(
  entries: Record<string, ResolvedOutcome> = {},
): jest.Mocked<ResolvedOutcomeStore> {
  const map = new Map(Object.entries(entries));
  return {
    has: jest.fn((domain: string) => Promise.resolve(map.has(domain))),
    get: jest.fn((domain: string) => Promise.resolve(map.get(domain))),
    set: jest.fn((domain: string, outcome: ResolvedOutcome) => {
      map.set(domain, outcome);
      return Promise.resolve();
    }),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

async function* asyncRows(rows: InputRow[]): AsyncGenerator<InputRow> {
  for (const row of rows) {
    yield row;
  }
}

describe('EnrichmentRunnerService', () => {
  let enrichmentService: jest.Mocked<EnrichmentService>;
  let runner: EnrichmentRunnerService;

  beforeEach(() => {
    enrichmentService = {
      enrich: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<EnrichmentService>;
    runner = new EnrichmentRunnerService(enrichmentService);
  });

  it('calls EnrichmentService.enrich once with the deduplicated, normalized, valid domain list', async () => {
    const writer = fakeOutputWriter();
    const store = fakeStore({
      'a.com': ok('a.com'),
      'b.com': ok('b.com'),
    });

    await runner.run({
      domains: asyncRows([
        { row: 1, raw: 'A.com' },
        { row: 2, raw: 'b.com' },
        { row: 3, raw: 'a.com' }, // duplicate of row 1, different case
      ]),
      outputWriter: writer,
      outcomeStore: store,
    });

    expect(enrichmentService.enrich).toHaveBeenCalledTimes(1);
    const [domains] = enrichmentService.enrich.mock.calls[0];
    expect(new Set(domains)).toEqual(new Set(['a.com', 'b.com']));
  });

  it('writes one output record per input row, including duplicates, in row order', async () => {
    const writer = fakeOutputWriter();
    const store = fakeStore({ 'a.com': ok('a.com') });

    await runner.run({
      domains: asyncRows([
        { row: 1, raw: 'a.com' },
        { row: 2, raw: 'a.com' }, // duplicate
      ]),
      outputWriter: writer,
      outcomeStore: store,
    });

    expect(writer.writeRecord).toHaveBeenCalledTimes(2);
    const [first, second] = writer.writeRecord.mock.calls.map((c) => c[0]);
    expect(first).toMatchObject({ row: 1, domain: 'a.com', status: 'ok' });
    expect(second).toMatchObject({ row: 2, domain: 'a.com', status: 'ok' });
  });

  it('marks a malformed domain INVALID_DOMAIN without ever sending it to EnrichmentService', async () => {
    const writer = fakeOutputWriter();
    const store = fakeStore({ 'a.com': ok('a.com') });

    await runner.run({
      domains: asyncRows([
        { row: 1, raw: 'a.com' },
        { row: 2, raw: 'not a domain' },
      ]),
      outputWriter: writer,
      outcomeStore: store,
    });

    const [domains] = enrichmentService.enrich.mock.calls[0];
    expect(domains).toEqual(['a.com']);

    const record: OutputRecord = writer.writeRecord.mock.calls[1][0];
    expect(record).toMatchObject({
      row: 2,
      domain: 'not a domain',
      status: 'failed',
      reason: 'INVALID_DOMAIN',
    });
  });

  it('produces a correct RunSummary (totalRows, uniqueDomains, succeeded, failed, failuresByReason)', async () => {
    const writer = fakeOutputWriter();
    const store = fakeStore({
      'a.com': ok('a.com'),
      'b.com': { status: 'failed', reason: 'NO_MATCH' },
    });

    const summary: RunSummary = await runner.run({
      domains: asyncRows([
        { row: 1, raw: 'a.com' },
        { row: 2, raw: 'b.com' },
        { row: 3, raw: 'not a domain' },
      ]),
      outputWriter: writer,
      outcomeStore: store,
      inputLabel: 'test.csv',
    });

    expect(summary).toEqual({
      input: 'test.csv',
      output: 'test-output',
      totalRows: 3,
      uniqueDomains: 2,
      succeeded: 1,
      failed: 2,
      failuresByReason: { NO_MATCH: 1, INVALID_DOMAIN: 1 },
      durationMs: expect.any(Number),
    });
  });

  it('calls outputWriter.finalize with the final summary', async () => {
    const writer = fakeOutputWriter();
    const store = fakeStore({ 'a.com': ok('a.com') });

    const summary = await runner.run({
      domains: asyncRows([{ row: 1, raw: 'a.com' }]),
      outputWriter: writer,
      outcomeStore: store,
    });

    expect(writer.finalize).toHaveBeenCalledWith(summary);
  });

  it('always closes the outcome store, even when the run throws', async () => {
    const writer = fakeOutputWriter();
    const store = fakeStore();
    enrichmentService.enrich.mockRejectedValue(new Error('provider down'));

    await expect(
      runner.run({
        domains: asyncRows([{ row: 1, raw: 'a.com' }]),
        outputWriter: writer,
        outcomeStore: store,
      }),
    ).rejects.toThrow('provider down');

    expect(store.close).toHaveBeenCalledTimes(1);
  });

  it('closes the outcome store on the happy path too', async () => {
    const writer = fakeOutputWriter();
    const store = fakeStore({ 'a.com': ok('a.com') });

    await runner.run({
      domains: asyncRows([{ row: 1, raw: 'a.com' }]),
      outputWriter: writer,
      outcomeStore: store,
    });

    expect(store.close).toHaveBeenCalledTimes(1);
  });

  it('defaults inputLabel to "(unlabeled)" when not supplied', async () => {
    const writer = fakeOutputWriter();
    const store = fakeStore({ 'a.com': ok('a.com') });

    const summary = await runner.run({
      domains: asyncRows([{ row: 1, raw: 'a.com' }]),
      outputWriter: writer,
      outcomeStore: store,
    });

    expect(summary.input).toBe('(unlabeled)');
  });

  it('forwards providerType/providerConfig/onBatchResolved through to EnrichmentService.enrich', async () => {
    const writer = fakeOutputWriter();
    const store = fakeStore({ 'a.com': ok('a.com') });
    const onBatchResolved = jest.fn();

    await runner.run({
      domains: asyncRows([{ row: 1, raw: 'a.com' }]),
      outputWriter: writer,
      outcomeStore: store,
      providerType: 'mock' as never,
      providerConfig: { apiKey: 'abc' },
      onBatchResolved,
    });

    expect(enrichmentService.enrich).toHaveBeenCalledWith(
      ['a.com'],
      store,
      'mock',
      { apiKey: 'abc' },
      onBatchResolved,
    );
  });
});
