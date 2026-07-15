import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  unlinkSync,
  writeSync,
} from 'fs';
import { randomBytes } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';
import { ResolvedOutcome } from '../providers/enrichment-provider.types';
import { ResolvedOutcomeStore } from './resolved-outcome-store.interface';

interface RecordLocation {
  offset: number;
  length: number;
}

/**
 * `ResolvedOutcomeStore` that appends every outcome to a local NDJSON file
 * instead of keeping it in memory — only a `domain -> {offset, length}`
 * index is held in memory, which is far smaller per-domain than a full
 * `EnrichedCompanyData` record. Trades write/read I/O for a bounded resident
 * footprint; use `OutcomeStoreType.MEMORY` unless that trade is actually
 * needed (see `InMemoryOutcomeStore`'s docs for the measured numbers).
 *
 * Concurrency: `set` is invoked concurrently — `EnrichmentService` resolves
 * multiple batches at once, each writing its own domains as it finishes.
 * Correctness here doesn't come from a lock; `set`/`get` are deliberately
 * plain (non-`async`) methods that only return `Promise.resolve(...)` at the
 * end — every `writeSync`/`readSync` call and the `writeOffset`
 * read-modify-write happen synchronously, with no `await` inside the method
 * at all. JS's single-threaded event loop can't interleave two calls that
 * never yield mid-critical-section, so concurrent `set` calls are naturally
 * serialized without needing an explicit mutex. Switching to async fs calls
 * for throughput would break that guarantee and require a real lock (e.g.
 * `Semaphore(1)`) around the offset-read/write/index-update sequence.
 */
export class FileOutcomeStore implements ResolvedOutcomeStore {
  private readonly filePath: string;
  private readonly fd: number;
  private readonly index = new Map<string, RecordLocation>();
  private writeOffset = 0;

  /** @param dir Directory the backing file is created in. Created if missing. */
  constructor(dir: string = tmpdir()) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.filePath = join(
      dir,
      `enrichment-outcomes-${process.pid}-${randomBytes(4).toString('hex')}.ndjson`,
    );
    this.fd = openSync(this.filePath, 'w+');
  }

  has(domain: string): Promise<boolean> {
    return Promise.resolve(this.index.has(domain));
  }

  get(domain: string): Promise<ResolvedOutcome | undefined> {
    const location = this.index.get(domain);
    if (!location) {
      return Promise.resolve(undefined);
    }
    const buffer = Buffer.alloc(location.length);
    readSync(this.fd, buffer, 0, location.length, location.offset);
    const { outcome } = JSON.parse(buffer.toString('utf-8')) as {
      outcome: ResolvedOutcome;
    };
    return Promise.resolve(outcome);
  }

  set(domain: string, outcome: ResolvedOutcome): Promise<void> {
    const line = JSON.stringify({ outcome }) + '\n';
    const buffer = Buffer.from(line, 'utf-8');
    writeSync(this.fd, buffer, 0, buffer.length, this.writeOffset);
    this.index.set(domain, { offset: this.writeOffset, length: buffer.length });
    this.writeOffset += buffer.length;
    return Promise.resolve();
  }

  close(): Promise<void> {
    closeSync(this.fd);
    unlinkSync(this.filePath);
    return Promise.resolve();
  }
}
