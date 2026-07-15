import { normalizeMockRecord } from './mock-enrichment-response.mapper';

describe('normalizeMockRecord', () => {
  it('passes through a fully well-formed record', () => {
    const result = normalizeMockRecord('a.com', {
      name: 'A Inc.',
      employeeCount: 250,
      industry: ['Software', 'B2B SaaS'],
      location: { city: 'San Francisco', country: 'US' },
      foundedYear: 2015,
      annualRevenueUsd: 5_000_000,
    });
    expect(result).toEqual({
      domain: 'a.com',
      name: 'A Inc.',
      employeeCount: 250,
      employeeCountRaw: 250,
      industry: ['Software', 'B2B SaaS'],
      location: { city: 'San Francisco', country: 'US' },
      foundedYear: 2015,
      annualRevenueUsd: 5_000_000,
    });
  });

  describe('employeeCount inconsistencies', () => {
    it('handles a plain number', () => {
      const r = normalizeMockRecord('a.com', { employeeCount: 42 });
      expect(r.employeeCount).toBe(42);
      expect(r.employeeCountRaw).toBe(42);
    });

    it('handles a banded string, averaging the bounds', () => {
      const r = normalizeMockRecord('a.com', { employeeCount: '100-500' });
      expect(r.employeeCount).toBe(300);
      expect(r.employeeCountRaw).toBe('100-500');
    });

    it('handles a banded string with thousands separators', () => {
      const r = normalizeMockRecord('a.com', {
        employeeCount: '1,000-5,000',
      });
      expect(r.employeeCount).toBe(3000);
      expect(r.employeeCountRaw).toBe('1,000-5,000');
    });

    it('handles a plain numeric string', () => {
      const r = normalizeMockRecord('a.com', { employeeCount: '250' });
      expect(r.employeeCount).toBe(250);
      expect(r.employeeCountRaw).toBe('250');
    });

    it('handles null', () => {
      const r = normalizeMockRecord('a.com', { employeeCount: null });
      expect(r.employeeCount).toBeNull();
      expect(r.employeeCountRaw).toBeNull();
    });

    it('handles an unparseable string as null count but keeps the raw value', () => {
      const r = normalizeMockRecord('a.com', { employeeCount: 'lots' });
      expect(r.employeeCount).toBeNull();
      expect(r.employeeCountRaw).toBe('lots');
    });

    it('handles a missing field as null/null', () => {
      const r = normalizeMockRecord('a.com', {});
      expect(r.employeeCount).toBeNull();
      expect(r.employeeCountRaw).toBeNull();
    });
  });

  describe('industry inconsistencies', () => {
    it('wraps a single string into a one-element array', () => {
      expect(
        normalizeMockRecord('a.com', { industry: 'Fintech' }).industry,
      ).toEqual(['Fintech']);
    });

    it('passes an array through, stringifying non-string elements', () => {
      expect(
        normalizeMockRecord('a.com', { industry: ['Fintech', 1] }).industry,
      ).toEqual(['Fintech', '1']);
    });

    it('defaults to an empty array for missing/empty/non-string values', () => {
      expect(normalizeMockRecord('a.com', {}).industry).toEqual([]);
      expect(normalizeMockRecord('a.com', { industry: '' }).industry).toEqual(
        [],
      );
      expect(normalizeMockRecord('a.com', { industry: null }).industry).toEqual(
        [],
      );
    });
  });

  describe('location inconsistencies', () => {
    it('handles a structured object', () => {
      expect(
        normalizeMockRecord('a.com', {
          location: { city: 'Berlin', country: 'DE' },
        }).location,
      ).toEqual({ city: 'Berlin', country: 'DE' });
    });

    it('handles a plain city string as city with no country', () => {
      expect(
        normalizeMockRecord('a.com', { location: 'Berlin' }).location,
      ).toEqual({ city: 'Berlin', country: null });
    });

    it('defaults to nulls for missing/malformed values', () => {
      expect(normalizeMockRecord('a.com', {}).location).toEqual({
        city: null,
        country: null,
      });
      expect(normalizeMockRecord('a.com', { location: 42 }).location).toEqual({
        city: null,
        country: null,
      });
    });
  });

  describe('name inconsistencies', () => {
    it('prefers "name" when present', () => {
      expect(
        normalizeMockRecord('a.com', {
          name: 'Real Name',
          companyName: 'Fallback',
        }).name,
      ).toBe('Real Name');
    });

    it('falls back to "companyName" when "name" is absent', () => {
      expect(
        normalizeMockRecord('a.com', { companyName: 'Fallback' }).name,
      ).toBe('Fallback');
    });

    it('is null when neither is present', () => {
      expect(normalizeMockRecord('a.com', {}).name).toBeNull();
    });
  });

  it('foundedYear and annualRevenueUsd default to null when absent or the wrong type', () => {
    const r = normalizeMockRecord('a.com', {
      foundedYear: '2020',
      annualRevenueUsd: 'lots',
    });
    expect(r.foundedYear).toBeNull();
    expect(r.annualRevenueUsd).toBeNull();
  });

  it('always sets domain to the domain argument, not anything from the raw record', () => {
    expect(normalizeMockRecord('given.com', {}).domain).toBe('given.com');
  });
});
