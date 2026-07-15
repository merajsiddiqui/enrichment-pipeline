import { ResolvedOutcome } from '../providers/enrichment-provider.types';
import { ResolvedOutcomeStore } from './resolved-outcome-store.interface';

/**
 * Default `ResolvedOutcomeStore`: a plain `Map`. Measured against a
 * synthetic 100k-domain run (100k input rows + 90k unique domains + fully
 * enriched outcomes, all resident at once — the actual peak moment in a
 * run), this costs ~120MB RSS, comfortably inside any realistic deployment
 * target. `FileOutcomeStore` exists for cases where that trade isn't
 * acceptable, not because this one is unsafe at the scale this pipeline is
 * built for.
 */
export class InMemoryOutcomeStore implements ResolvedOutcomeStore {
  private readonly map = new Map<string, ResolvedOutcome>();

  has(domain: string): Promise<boolean> {
    return Promise.resolve(this.map.has(domain));
  }

  get(domain: string): Promise<ResolvedOutcome | undefined> {
    return Promise.resolve(this.map.get(domain));
  }

  set(domain: string, outcome: ResolvedOutcome): Promise<void> {
    this.map.set(domain, outcome);
    return Promise.resolve();
  }

  close(): Promise<void> {
    // Nothing to release — the Map is garbage-collected with this instance.
    return Promise.resolve();
  }
}
