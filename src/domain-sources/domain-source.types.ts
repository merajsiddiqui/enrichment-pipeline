/**
 * One domain to enrich, tagged with a sequential row number so it can be
 * correlated back to exactly one output record regardless of processing
 * order. Deliberately source-agnostic — a CSV row, a JSON array element,
 * or any future source all produce the same shape, which is what lets
 * `EnrichmentService` accept "a list of domains" without knowing or caring
 * how they were extracted.
 */
export interface InputRow {
  /** 1-based sequential index among the domains this source produced. */
  row: number;
  /** The raw, unmodified domain text for this row. */
  raw: string;
}
