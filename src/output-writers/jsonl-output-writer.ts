import { createWriteStream, mkdirSync, WriteStream } from 'fs';
import { writeFile } from 'fs/promises';
import { dirname } from 'path';
import { OutputWriter } from './output-writer.interface';
import { OutputRecord, RunSummary } from './output.types';

/**
 * Writes one JSON object per line to `outputPath`, streaming — records are
 * written as they arrive rather than buffered, so this scales the same at
 * 40 rows or 100k+. `finalize` closes the stream and writes
 * `<outputPath>.summary.json` alongside it.
 *
 * A plain class, not a Nest-injected singleton: it holds per-run state (an
 * open file handle) that must not be shared across concurrent runs, so each
 * caller constructs its own instance with `new JsonlOutputWriter(path)` —
 * the same reasoning `EnrichmentProviderManager` uses for building providers
 * with `new` instead of resolving them from the DI container.
 */
export class JsonlOutputWriter implements OutputWriter {
  private readonly stream: WriteStream;
  readonly description: string;

  constructor(private readonly outputPath: string) {
    // `createWriteStream` never creates missing parent directories itself —
    // a CLI/API caller shouldn't have to `mkdir` an output path by hand
    // before every run.
    mkdirSync(dirname(outputPath), { recursive: true });
    this.stream = createWriteStream(outputPath, { encoding: 'utf-8' });
    this.description = outputPath;
  }

  /** @inheritdoc */
  writeRecord(record: OutputRecord): void {
    this.stream.write(JSON.stringify(record) + '\n');
  }

  /** @inheritdoc */
  async finalize(summary: RunSummary): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
    await writeFile(
      `${this.outputPath}.summary.json`,
      JSON.stringify(summary, null, 2),
    );
  }
}
