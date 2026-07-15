import { ResolvedOutcome } from '../providers/enrichment-provider.types';

/** Which `ResolvedOutcomeStore` implementation to use for a run. */
export enum OutcomeStoreType {
  /** A plain in-memory `Map` — fast, and (measured against a synthetic 100k-domain run) comfortably fits in memory on its own. The default. */
  MEMORY = 'memory',
  /** Spills resolved outcomes to a local file, keeping only a byte-offset index in memory — trades speed for a smaller resident memory footprint. */
  FILE = 'file',
}

/**
 * Where `EnrichmentService` merges resolved outcomes as batches complete,
 * and where `EnrichmentRunnerService` looks them up when correlating output
 * rows. Exists so *how* a run holds its results (in memory vs. spilled to
 * disk) is a swappable implementation detail neither of those classes needs
 * to know about — mirrors how `OutputWriter` already decouples "write a
 * record" from the concrete destination.
 *
 * Constructed by the CLI/API (see `createOutcomeStore`), not resolved by
 * `EnrichmentService`/`EnrichmentRunnerService` — same reasoning
 * `EnrichmentProviderManager` and `OutputWriter` already follow: a store
 * holds per-run state (an open file handle, for `FileOutcomeStore`), so it
 * can't be a shared Nest singleton.
 */
export interface ResolvedOutcomeStore {
  /** Whether `domain` has a stored outcome yet. */
  has(domain: string): Promise<boolean>;
  /** The stored outcome for `domain`, or `undefined` if none has been set. */
  get(domain: string): Promise<ResolvedOutcome | undefined>;
  /** Store (or overwrite) the outcome for `domain`. */
  set(domain: string, outcome: ResolvedOutcome): Promise<void>;
  /** Release any resources held (e.g. close and delete a backing temp file). Safe to call even if nothing needs releasing. */
  close(): Promise<void>;
}
