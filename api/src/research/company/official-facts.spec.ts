import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeFinancials } from './financials';
import { readGaapFacts } from './sec-documents';

/**
 * Full companyconcept responses fetched 2026-11-08 from
 * https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/<tag>.json
 * The bytes are the response body. Expected figures below were derived by hand
 * from those filed values.
 */

function loadConcept(name: string, sha256: string) {
  const bytes = readFileSync(join(__dirname, 'fixtures', name));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha256);
  const concept = JSON.parse(bytes.toString('utf8')) as {
    cik: number;
    entityName: string;
    taxonomy: string;
    tag: string;
    description: string;
    units: unknown;
  };
  expect(concept.taxonomy).toBe('us-gaap');
  expect(concept.entityName).toBe('Apple Inc.');
  const facts = readGaapFacts({
    cik: concept.cik,
    entityName: concept.entityName,
    facts: {
      'us-gaap': {
        [concept.tag]: {
          label: concept.tag,
          description: concept.description,
          units: concept.units,
        },
      },
    },
  });
  return { concept, facts };
}

function report(facts: ReturnType<typeof readGaapFacts>, asOf: string) {
  return normalizeFinancials({
    name: 'Apple',
    ticker: 'AAPL',
    cik: '0000320193',
    fiscalYearEndMonth: 9,
    asOf,
    facts,
    filings: [],
  });
}

describe('official Apple companyconcept responses', () => {
  it('places the April 1, 2017 quarter as FY2017 Q2 and does not copy the concept description', () => {
    const { concept, facts } = loadConcept(
      'aapl-sales-revenue-net.json',
      '8b37365a7f187479d40d872ed51551ca40a3981268248b91ba2643cbfb152591',
    );
    const april = facts.find(
      (fact) =>
        fact.start === '2017-01-01' &&
        fact.end === '2017-04-01' &&
        fact.accn === '0001628280-17-004790',
    );
    expect(april).toMatchObject({
      val: 52896000000,
      fp: 'Q2',
      fy: 2017,
      form: '10-Q',
      filed: '2017-05-03',
    });
    const comparative = facts.find(
      (fact) =>
        fact.start === '2017-01-01' &&
        fact.end === '2017-04-01' &&
        fact.accn === '0000320193-17-000070',
    );
    expect(comparative?.fp).toBe('FY');
    const result = report(facts, '2017-11-04');
    expect(result.data.latestQuarter).toMatchObject({
      fiscalYear: 2017,
      fiscalQuarter: 4,
      end: '2017-09-30',
      derived: undefined,
      revenue: { value: 52579000000 },
    });
    expect(result.data.ttm?.revenue.value).toBe(229234000000);
    expect(result.data.latestAnnual).toMatchObject({
      fiscalYear: 2017,
      revenue: { value: 229234000000 },
    });
    expect(
      result.data.ttm?.revenue.inputCitations?.some(
        (item) => item.periodEnd === '2017-04-01' && item.value === 52896000000,
      ),
    ).toBe(true);
    expect(result.data.latestQuarter?.fiscalQuarter).not.toBe(3);
    const text = JSON.stringify(result.data);
    expect(text).not.toContain(concept.description.slice(0, 40));
    expect(text).not.toContain('performance obligation');
  });

  it('derives FY2026 Q4 and annual growth from the current revenue concept', () => {
    const { facts } = loadConcept(
      'aapl-revenue-concept.json',
      '472558a2993a429b6a4381ff32cc278f95b3d0807c6efa6cabc508f6baf61c79',
    );
    const spilled = facts.find(
      (fact) => fact.start === '2023-01-01' && fact.end === '2023-04-01',
    );
    expect(spilled).toMatchObject({
      val: 94836000000,
      form: '10-Q',
      filed: '2023-05-05',
    });
    const fy2023 = report(facts, '2023-11-04');
    expect(fy2023.data.latestQuarter).toMatchObject({
      fiscalYear: 2023,
      fiscalQuarter: 4,
      end: '2023-09-30',
      revenue: { value: 89498000000, derived: true },
    });
    expect(
      fy2023.data.latestQuarter?.revenue.inputCitations?.some(
        (item) => item.periodEnd === '2023-04-01' && item.value === 94836000000,
      ),
    ).toBe(true);
    expect(fy2023.data.ttm?.revenue.value).toBe(383285000000);
    expect(fy2023.data.growth?.annualRevenue).toMatchObject({
      value: -0.028005,
    });
    const text = JSON.stringify(fy2023.data);
    expect(text).not.toContain('211990000000');
    expect(text).not.toContain('364357000000');

    const current = report(facts, '2026-11-08');
    expect(current.data.latestQuarter?.revenue).toMatchObject({
      value: 114477000000,
      derived: true,
      formula: 'full_year - q1 - q2 - q3',
    });
    expect(current.data.latestQuarter).toMatchObject({
      fiscalYear: 2026,
      fiscalQuarter: 4,
      start: '2026-06-28',
      end: '2026-09-26',
    });
    expect(current.data.ttm?.revenue.value).toBe(478834000000);
    expect(current.data.latestAnnual?.revenue.value).toBe(478834000000);
    expect(current.data.growth?.annualRevenue.value).toBe(0.150598);
  });

  it('keeps FY2026 when the deprecated SalesRevenueNet concept is merged in', () => {
    const current = loadConcept(
      'aapl-revenue-concept.json',
      '472558a2993a429b6a4381ff32cc278f95b3d0807c6efa6cabc508f6baf61c79',
    );
    const legacy = loadConcept(
      'aapl-sales-revenue-net.json',
      '8b37365a7f187479d40d872ed51551ca40a3981268248b91ba2643cbfb152591',
    );
    const merged = report([...legacy.facts, ...current.facts], '2026-11-08');
    expect(merged.data.latestQuarter).toMatchObject({
      fiscalYear: 2026,
      fiscalQuarter: 4,
      start: '2026-06-28',
      end: '2026-09-26',
      revenue: { value: 114477000000, derived: true },
    });
    expect(merged.data.latestAnnual?.revenue.value).toBe(478834000000);
    expect(merged.data.ttm?.revenue.value).toBe(478834000000);
    expect(merged.data.growth?.annualRevenue.value).toBe(0.150598);
    expect(merged.data.latestQuarter?.revenue.citation?.concept).not.toBe(
      'SalesRevenueNet',
    );
  });
});
