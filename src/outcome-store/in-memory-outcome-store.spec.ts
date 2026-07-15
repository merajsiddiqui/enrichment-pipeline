import { InMemoryOutcomeStore } from './in-memory-outcome-store';
import { ResolvedOutcome } from '../providers/enrichment-provider.types';

const OK: ResolvedOutcome = {
  status: 'ok',
  data: {
    domain: 'a.com',
    name: 'A Inc.',
    employeeCount: 10,
    employeeCountRaw: 10,
    industry: ['Software'],
    location: { city: 'SF', country: 'US' },
    foundedYear: 2020,
    annualRevenueUsd: 1_000_000,
  },
};

describe('InMemoryOutcomeStore', () => {
  it('has() is false and get() is undefined before anything is set', async () => {
    const store = new InMemoryOutcomeStore();
    expect(await store.has('a.com')).toBe(false);
    expect(await store.get('a.com')).toBeUndefined();
  });

  it('set() then get()/has() reflects the stored outcome', async () => {
    const store = new InMemoryOutcomeStore();
    await store.set('a.com', OK);
    expect(await store.has('a.com')).toBe(true);
    expect(await store.get('a.com')).toEqual(OK);
  });

  it('set() overwrites a previous value for the same domain', async () => {
    const store = new InMemoryOutcomeStore();
    await store.set('a.com', OK);
    const failed: ResolvedOutcome = { status: 'failed', reason: 'NO_MATCH' };
    await store.set('a.com', failed);
    expect(await store.get('a.com')).toEqual(failed);
  });

  it('close() resolves without throwing and does not clear stored data', async () => {
    const store = new InMemoryOutcomeStore();
    await store.set('a.com', OK);
    await expect(store.close()).resolves.toBeUndefined();
    expect(await store.get('a.com')).toEqual(OK);
  });
});
