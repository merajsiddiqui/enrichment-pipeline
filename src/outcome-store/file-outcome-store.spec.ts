import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileOutcomeStore } from './file-outcome-store';
import { ResolvedOutcome } from '../providers/enrichment-provider.types';

function makeOutcome(domain: string, n: number): ResolvedOutcome {
  return {
    status: 'ok',
    data: {
      domain,
      name: `Company ${n}`,
      employeeCount: n,
      employeeCountRaw: n,
      industry: ['Software'],
      location: { city: 'SF', country: 'US' },
      foundedYear: 2020,
      annualRevenueUsd: n * 1000,
    },
  };
}

describe('FileOutcomeStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'file-outcome-store-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates its backing directory if missing', () => {
    const missingDir = join(dir, 'does', 'not', 'exist', 'yet');
    expect(() => new FileOutcomeStore(missingDir)).not.toThrow();
    expect(existsSync(missingDir)).toBe(true);
  });

  it('has() is false and get() is undefined before anything is set', async () => {
    const store = new FileOutcomeStore(dir);
    expect(await store.has('a.com')).toBe(false);
    expect(await store.get('a.com')).toBeUndefined();
    await store.close();
  });

  it('set() then get()/has() reflects the stored outcome, read back from disk', async () => {
    const store = new FileOutcomeStore(dir);
    const outcome = makeOutcome('a.com', 1);
    await store.set('a.com', outcome);
    expect(await store.has('a.com')).toBe(true);
    expect(await store.get('a.com')).toEqual(outcome);
    await store.close();
  });

  it("handles multiple distinct entries correctly (offsets don't collide)", async () => {
    const store = new FileOutcomeStore(dir);
    for (let i = 0; i < 20; i++) {
      await store.set(`domain-${i}.com`, makeOutcome(`domain-${i}.com`, i));
    }
    for (let i = 0; i < 20; i++) {
      const outcome = await store.get(`domain-${i}.com`);
      expect(outcome).toEqual(makeOutcome(`domain-${i}.com`, i));
    }
    await store.close();
  });

  it('stays correct under concurrent set() calls (no shared-state corruption)', async () => {
    const store = new FileOutcomeStore(dir);
    const N = 500;

    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        store.set(`domain-${i}.com`, makeOutcome(`domain-${i}.com`, i)),
      ),
    );

    for (let i = 0; i < N; i++) {
      const outcome = await store.get(`domain-${i}.com`);
      expect(outcome).toEqual(makeOutcome(`domain-${i}.com`, i));
    }
    await store.close();
  });

  it('close() deletes its backing temp file, leaving no residue', async () => {
    const store = new FileOutcomeStore(dir);
    await store.set('a.com', makeOutcome('a.com', 1));
    expect(readdirSync(dir)).toHaveLength(1);

    await store.close();

    expect(readdirSync(dir)).toHaveLength(0);
  });

  it('uses a distinct backing file per instance (no cross-instance collisions)', async () => {
    const storeA = new FileOutcomeStore(dir);
    const storeB = new FileOutcomeStore(dir);

    await storeA.set('a.com', makeOutcome('a.com', 1));
    await storeB.set('a.com', makeOutcome('a.com', 999));

    expect(await storeA.get('a.com')).toEqual(makeOutcome('a.com', 1));
    expect(await storeB.get('a.com')).toEqual(makeOutcome('a.com', 999));

    await storeA.close();
    await storeB.close();
  });
});
