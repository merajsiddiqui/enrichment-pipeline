import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createOutcomeStore } from './outcome-store.factory';
import { InMemoryOutcomeStore } from './in-memory-outcome-store';
import { FileOutcomeStore } from './file-outcome-store';
import { ResolvedOutcomeStore } from './resolved-outcome-store.interface';

describe('createOutcomeStore', () => {
  const ORIGINAL_ENV = process.env;
  let dir: string;
  let created: ResolvedOutcomeStore[] = [];

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    dir = mkdtempSync(join(tmpdir(), 'outcome-store-factory-test-'));
    created = [];
  });

  afterEach(async () => {
    await Promise.all(created.map((store) => store.close()));
    rmSync(dir, { recursive: true, force: true });
    process.env = ORIGINAL_ENV;
  });

  function build(): ResolvedOutcomeStore {
    const store = createOutcomeStore();
    created.push(store);
    return store;
  }

  it('defaults to InMemoryOutcomeStore when ENRICHMENT_OUTCOME_STORE is unset', () => {
    delete process.env.ENRICHMENT_OUTCOME_STORE;
    expect(build()).toBeInstanceOf(InMemoryOutcomeStore);
  });

  it('returns InMemoryOutcomeStore when explicitly set to "memory"', () => {
    process.env.ENRICHMENT_OUTCOME_STORE = 'memory';
    expect(build()).toBeInstanceOf(InMemoryOutcomeStore);
  });

  it('returns FileOutcomeStore when set to "file", using ENRICHMENT_OUTCOME_STORE_DIR', () => {
    process.env.ENRICHMENT_OUTCOME_STORE = 'file';
    process.env.ENRICHMENT_OUTCOME_STORE_DIR = dir;
    expect(build()).toBeInstanceOf(FileOutcomeStore);
  });

  it('throws a clear error for an unrecognized value', () => {
    process.env.ENRICHMENT_OUTCOME_STORE = 'bogus';
    expect(() => createOutcomeStore()).toThrow(
      /unknown ENRICHMENT_OUTCOME_STORE "bogus"/,
    );
  });
});
