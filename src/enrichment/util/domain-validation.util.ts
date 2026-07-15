const DOMAIN_RE =
  /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;

/**
 * Reports whether `raw` looks like a well-formed domain (e.g. `example.com`).
 * Input rows can contain empty lines, prose, or garbage; rejecting those here
 * avoids spending a rate-limited provider call on something that can never
 * resolve, and marks the row `INVALID_DOMAIN` instead of silently dropping it.
 */
export function isValidDomain(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed.length > 0 && DOMAIN_RE.test(trimmed);
}

/**
 * Normalizes a domain for deduplication/lookup purposes (trim + lowercase),
 * e.g. so `Stripe.com` and `stripe.com` resolve to one provider call. The
 * original raw text is preserved separately for the output record.
 */
export function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase();
}
