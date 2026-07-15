import { EnrichedCompanyData } from '../enrichment-provider.types';

/**
 * Translates the mock provider's v2 response schema (`starter-kit/API.md`)
 * into the app's common `EnrichedCompanyData` shape. This logic is specific
 * to this one provider's documented inconsistencies — `employeeCount` as a
 * number, a banded string, or `null`; `industry` as a string or string[];
 * `location` as an object or a plain city string — and lives next to
 * `MockEnrichmentProvider` rather than as a shared/generic util, since a
 * different provider would need its own translation, not this one.
 */

function normalizeEmployeeCount(value: unknown): {
  employeeCount: number | null;
  employeeCountRaw: string | number | null;
} {
  if (typeof value === 'number') {
    return { employeeCount: value, employeeCountRaw: value };
  }
  if (typeof value === 'string') {
    const band = value.match(/^([\d,]+)\s*-\s*([\d,]+)$/);
    if (band) {
      const low = Number(band[1].replace(/,/g, ''));
      const high = Number(band[2].replace(/,/g, ''));
      return {
        employeeCount: Math.round((low + high) / 2),
        employeeCountRaw: value,
      };
    }
    const asNumber = Number(value.replace(/,/g, ''));
    return {
      employeeCount: Number.isFinite(asNumber) ? asNumber : null,
      employeeCountRaw: value,
    };
  }
  return { employeeCount: null, employeeCountRaw: null };
}

function normalizeIndustry(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value.length > 0) return [value];
  return [];
}

function normalizeLocation(value: unknown): {
  city: string | null;
  country: string | null;
} {
  if (value && typeof value === 'object') {
    const loc = value as Record<string, unknown>;
    return {
      city: typeof loc.city === 'string' ? loc.city : null,
      country: typeof loc.country === 'string' ? loc.country : null,
    };
  }
  if (typeof value === 'string' && value.length > 0) {
    return { city: value, country: null };
  }
  return { city: null, country: null };
}

/** Normalizes one raw mock-provider v2 record for `domain` into `EnrichedCompanyData`. */
export function normalizeMockRecord(
  domain: string,
  raw: Record<string, unknown>,
): EnrichedCompanyData {
  const { employeeCount, employeeCountRaw } = normalizeEmployeeCount(
    raw.employeeCount,
  );
  return {
    domain,
    name:
      typeof raw.name === 'string'
        ? raw.name
        : typeof raw.companyName === 'string'
          ? raw.companyName
          : null,
    employeeCount,
    employeeCountRaw,
    industry: normalizeIndustry(raw.industry),
    location: normalizeLocation(raw.location),
    foundedYear: typeof raw.foundedYear === 'number' ? raw.foundedYear : null,
    annualRevenueUsd:
      typeof raw.annualRevenueUsd === 'number' ? raw.annualRevenueUsd : null,
  };
}
