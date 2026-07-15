import { isValidDomain, normalizeDomain } from './domain-validation.util';

describe('isValidDomain', () => {
  it.each([
    'example.com',
    'sub.example.com',
    'my-company.io',
    'a.b.c.d.example.com',
    'EXAMPLE.COM',
  ])('accepts well-formed domain %s', (domain) => {
    expect(isValidDomain(domain)).toBe(true);
  });

  it.each([
    '',
    '   ',
    'not a domain',
    'no-dot',
    '-leading-hyphen.com',
    'trailing-hyphen-.com',
    'double..dot.com',
    '.leading-dot.com',
    'trailing-dot.com.',
  ])('rejects malformed input %j', (raw) => {
    expect(isValidDomain(raw)).toBe(false);
  });

  it('trims surrounding whitespace before validating', () => {
    expect(isValidDomain('  example.com  ')).toBe(true);
  });
});

describe('normalizeDomain', () => {
  it('trims and lowercases', () => {
    expect(normalizeDomain('  Stripe.COM  ')).toBe('stripe.com');
  });

  it('makes case-variant duplicates collide to the same key', () => {
    expect(normalizeDomain('Stripe.com')).toBe(normalizeDomain('stripe.com'));
  });
});
