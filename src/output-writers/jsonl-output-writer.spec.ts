import { readFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { JsonlOutputWriter } from './jsonl-output-writer';
import { OutputRecord, RunSummary } from './output.types';

describe('JsonlOutputWriter', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jsonl-writer-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // Every test below calls finalize() before finishing, even ones not
  // testing finalize's own behavior — leaving a JsonlOutputWriter's
  // WriteStream open past the end of a test risks it still being mid-open
  // when afterEach removes the temp dir, which surfaces as an unhandled
  // 'error' event Jest attributes to whatever test runs next.

  it('creates missing parent directories rather than requiring them to exist', async () => {
    const outputPath = join(dir, 'nested', 'deep', 'output.jsonl');
    const writer = new JsonlOutputWriter(outputPath);
    expect(existsSync(join(dir, 'nested', 'deep'))).toBe(true);
    await writer.finalize({
      input: 'x',
      output: outputPath,
      totalRows: 0,
      uniqueDomains: 0,
      succeeded: 0,
      failed: 0,
      failuresByReason: {},
      durationMs: 0,
    });
  });

  it('sets description to the output path', async () => {
    const outputPath = join(dir, 'output.jsonl');
    const writer = new JsonlOutputWriter(outputPath);
    expect(writer.description).toBe(outputPath);
    await writer.finalize({
      input: 'x',
      output: outputPath,
      totalRows: 0,
      uniqueDomains: 0,
      succeeded: 0,
      failed: 0,
      failuresByReason: {},
      durationMs: 0,
    });
  });

  it('writes one JSON line per record, in order', async () => {
    const outputPath = join(dir, 'output.jsonl');
    const writer = new JsonlOutputWriter(outputPath);

    const records: OutputRecord[] = [
      { row: 1, domain: 'a.com', status: 'ok', data: undefined },
      { row: 2, domain: 'b.com', status: 'failed', reason: 'NO_MATCH' },
    ];
    records.forEach((r) => writer.writeRecord(r));

    const summary: RunSummary = {
      input: 'test',
      output: outputPath,
      totalRows: 2,
      uniqueDomains: 2,
      succeeded: 1,
      failed: 1,
      failuresByReason: { NO_MATCH: 1 },
      durationMs: 5,
    };
    await writer.finalize(summary);

    const lines = readFileSync(outputPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ row: 1, domain: 'a.com' });
    expect(JSON.parse(lines[1])).toMatchObject({
      row: 2,
      domain: 'b.com',
      reason: 'NO_MATCH',
    });
  });

  it('finalize writes <outputPath>.summary.json with the summary contents', async () => {
    const outputPath = join(dir, 'output.jsonl');
    const writer = new JsonlOutputWriter(outputPath);
    const summary: RunSummary = {
      input: 'test.csv',
      output: outputPath,
      totalRows: 10,
      uniqueDomains: 9,
      succeeded: 8,
      failed: 1,
      failuresByReason: { INVALID_DOMAIN: 1 },
      durationMs: 123,
    };

    await writer.finalize(summary);

    const written = JSON.parse(
      readFileSync(`${outputPath}.summary.json`, 'utf-8'),
    );
    expect(written).toEqual(summary);
  });

  it('handles zero records written before finalize (an empty run)', async () => {
    const outputPath = join(dir, 'output.jsonl');
    const writer = new JsonlOutputWriter(outputPath);
    await writer.finalize({
      input: 'empty.csv',
      output: outputPath,
      totalRows: 0,
      uniqueDomains: 0,
      succeeded: 0,
      failed: 0,
      failuresByReason: {},
      durationMs: 0,
    });
    expect(readFileSync(outputPath, 'utf-8')).toBe('');
    expect(existsSync(`${outputPath}.summary.json`)).toBe(true);
  });
});
