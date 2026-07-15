import { domainsFromArray } from './json-domain-source';

describe('domainsFromArray', () => {
  it('yields one InputRow per domain, numbered from 1 in order', () => {
    const rows = [...domainsFromArray(['a.com', 'b.com', 'c.com'])];
    expect(rows).toEqual([
      { row: 1, raw: 'a.com' },
      { row: 2, raw: 'b.com' },
      { row: 3, raw: 'c.com' },
    ]);
  });

  it('yields nothing for an empty array', () => {
    expect([...domainsFromArray([])]).toEqual([]);
  });

  it('preserves duplicate/raw values verbatim, including invalid-looking ones', () => {
    const rows = [...domainsFromArray(['a.com', 'a.com', 'not a domain'])];
    expect(rows).toEqual([
      { row: 1, raw: 'a.com' },
      { row: 2, raw: 'a.com' },
      { row: 3, raw: 'not a domain' },
    ]);
  });

  it('is a fresh generator each call — consuming one does not affect another', () => {
    const gen1 = domainsFromArray(['a.com']);
    const gen2 = domainsFromArray(['b.com']);
    expect([...gen1]).toEqual([{ row: 1, raw: 'a.com' }]);
    expect([...gen2]).toEqual([{ row: 1, raw: 'b.com' }]);
  });
});
