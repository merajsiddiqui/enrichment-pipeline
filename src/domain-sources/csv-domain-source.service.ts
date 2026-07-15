import { Injectable } from '@nestjs/common';
import { createReadStream } from 'fs';
import { parse } from 'csv-parse';
import { InputRow } from './domain-source.types';

/**
 * Extracts domains from a CSV file with a `domain` column. The one place in
 * the app that knows how to read a CSV — used by both the CLI (`enrich
 * --input <path>`) and the HTTP API's CSV-upload endpoint, and used by
 * neither `EnrichmentService` nor `EnrichmentRunnerService`, which only ever
 * see the resulting `AsyncIterable<InputRow>`.
 */
@Injectable()
export class CsvDomainSourceService {
  /**
   * Streams domains one row at a time (a `fs` read stream piped through
   * `csv-parse`) rather than reading the file into memory first — parsing
   * itself scales the same whether the input has 40 rows or 100k+.
   * `EnrichmentRunnerService` still consumes the whole stream into memory
   * before enriching (see its docs), so this only bounds the *parsing*
   * side, not a run's overall memory footprint.
   *
   * @param inputPath Path to a CSV file with a `domain` column.
   */
  async *extractDomains(inputPath: string): AsyncGenerator<InputRow> {
    const parser = createReadStream(inputPath).pipe(
      parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }),
    );

    let row = 0;
    for await (const record of parser as AsyncIterable<
      Record<string, string>
    >) {
      row += 1;
      yield { row, raw: record.domain ?? '' };
    }
  }
}
