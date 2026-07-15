import { InputRow } from './domain-source.types';

/**
 * Wraps a plain array of domain strings (e.g. a JSON request body's
 * `domains` field) as an `Iterable<InputRow>` — the same conceptual shape
 * `CsvDomainSourceService.extractDomains` produces
 * (`EnrichmentRunnerService`'s input accepts either sync or async), so the
 * runner can't tell — and doesn't need to — whether its input came from a
 * file or a JSON payload.
 *
 * Not a service: there's no extraction happening, no I/O, no dependency to
 * inject — just reshaping an array that's already in hand, which is a
 * one-line pure function, not a responsibility that deserves its own class.
 *
 * @param domains Raw domain strings, in the order they should be numbered.
 */
export function* domainsFromArray(domains: string[]): Generator<InputRow> {
  let row = 0;
  for (const raw of domains) {
    row += 1;
    yield { row, raw };
  }
}
