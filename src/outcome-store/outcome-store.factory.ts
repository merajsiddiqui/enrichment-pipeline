import { FileOutcomeStore } from './file-outcome-store';
import { InMemoryOutcomeStore } from './in-memory-outcome-store';
import {
  OutcomeStoreType,
  ResolvedOutcomeStore,
} from './resolved-outcome-store.interface';

/**
 * Builds the `ResolvedOutcomeStore` for one run, from `ENRICHMENT_OUTCOME_STORE`
 * (`memory` — the default — or `file`) and, for `file`, `ENRICHMENT_OUTCOME_STORE_DIR`
 * (defaults to the OS temp directory).
 *
 * A plain function, not a Nest-injectable, called directly by the CLI/API —
 * same reasoning as `JsonlOutputWriter` being constructed with `new`: the
 * result holds per-run state, so there's no single shared instance for the
 * DI container to own.
 */
/** Constructors keyed by type — a map instead of a `switch` so an unrecognized env value falls through to a normal runtime error rather than an unreachable `default`. */
const factories: Record<OutcomeStoreType, () => ResolvedOutcomeStore> = {
  [OutcomeStoreType.FILE]: () =>
    new FileOutcomeStore(process.env.ENRICHMENT_OUTCOME_STORE_DIR),
  [OutcomeStoreType.MEMORY]: () => new InMemoryOutcomeStore(),
};

export function createOutcomeStore(): ResolvedOutcomeStore {
  const type = (process.env.ENRICHMENT_OUTCOME_STORE ??
    OutcomeStoreType.MEMORY) as OutcomeStoreType;

  const factory = factories[type];
  if (!factory) {
    throw new Error(
      `unknown ENRICHMENT_OUTCOME_STORE "${String(type)}" — expected one of: ${Object.values(OutcomeStoreType).join(', ')}`,
    );
  }
  return factory();
}
