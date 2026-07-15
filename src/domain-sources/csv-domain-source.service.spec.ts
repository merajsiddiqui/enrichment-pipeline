import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CsvDomainSourceService } from './csv-domain-source.service';

describe('CsvDomainSourceService', () => {
  let dir: string;
  let service: CsvDomainSourceService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'csv-domain-source-test-'));
    service = new CsvDomainSourceService();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeCsv(contents: string): string {
    const path = join(dir, 'domains.csv');
    writeFileSync(path, contents);
    return path;
  }

  async function collect(path: string) {
    const rows = [];
    for await (const row of service.extractDomains(path)) {
      rows.push(row);
    }
    return rows;
  }

  it('yields one InputRow per data row, 1-indexed, reading the "domain" column', async () => {
    const path = writeCsv('domain\nstripe.com\nnotion.so\n');
    const rows = await collect(path);
    expect(rows).toEqual([
      { row: 1, raw: 'stripe.com' },
      { row: 2, raw: 'notion.so' },
    ]);
  });

  it('skips blank lines rather than yielding empty rows for them', async () => {
    const path = writeCsv('domain\nstripe.com\n\nnotion.so\n');
    const rows = await collect(path);
    expect(rows).toEqual([
      { row: 1, raw: 'stripe.com' },
      { row: 2, raw: 'notion.so' },
    ]);
  });

  it('trims whitespace around values', async () => {
    const path = writeCsv('domain\n  stripe.com  \n');
    const rows = await collect(path);
    expect(rows).toEqual([{ row: 1, raw: 'stripe.com' }]);
  });

  it('yields raw: "" for a row with an empty domain cell, rather than skipping it', async () => {
    const path = writeCsv('domain,other\n,foo\nstripe.com,bar\n');
    const rows = await collect(path);
    expect(rows).toEqual([
      { row: 1, raw: '' },
      { row: 2, raw: 'stripe.com' },
    ]);
  });

  it('ignores columns other than "domain"', async () => {
    const path = writeCsv('other,domain\nfoo,stripe.com\n');
    const rows = await collect(path);
    expect(rows).toEqual([{ row: 1, raw: 'stripe.com' }]);
  });

  it('yields nothing for a header-only file', async () => {
    const path = writeCsv('domain\n');
    expect(await collect(path)).toEqual([]);
  });
});
