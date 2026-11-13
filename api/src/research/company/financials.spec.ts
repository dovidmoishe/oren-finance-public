import {
  fiscalYearForAnnualEnd,
  normalizeFinancials,
  type NormalizedFactInput,
} from './financials';
import { readGaapFacts } from './sec-documents';

const CIK = '0000320193';

function fact(
  partial: Partial<NormalizedFactInput> &
    Pick<NormalizedFactInput, 'end' | 'val'>,
): NormalizedFactInput {
  return {
    concept: 'Revenues',
    unit: 'USD',
    accn: '0000320193-26-000001',
    form: '10-Q',
    filed: '2026-05-01',
    ...partial,
  };
}

function run(
  facts: NormalizedFactInput[],
  options?: { asOf?: string; fiscalYearEndMonth?: number; filings?: [] },
) {
  return normalizeFinancials({
    name: 'Apple',
    ticker: 'AAPL',
    cik: CIK,
    fiscalYearEndMonth: options?.fiscalYearEndMonth ?? 12,
    asOf: options?.asOf ?? '2026-12-31',
    facts,
    filings: options?.filings ?? [
      {
        form: '10-Q',
        filed: '2026-11-03',
        accession: '0000320193-26-000026',
        sourceUrl:
          'https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/0000320193-26-000026-index.html',
      },
    ],
  });
}

describe('fiscal labels', () => {
  it('keeps a year end that spills a few days past the fiscal-year-end month', () => {
    expect(fiscalYearForAnnualEnd('2026-02-01', 1)).toBe(2026);
    expect(fiscalYearForAnnualEnd('2026-10-02', 9)).toBe(2026);
    expect(fiscalYearForAnnualEnd('2026-09-26', 9)).toBe(2026);
    expect(fiscalYearForAnnualEnd('2017-04-01', 9)).toBeUndefined();
  });

  it('labels a January fiscal Q4 that ends on February 1 from the period chain', () => {
    const result = run(
      [
        fact({
          start: '2025-02-03',
          end: '2026-02-01',
          val: 100,
          form: '10-K',
          filed: '2026-02-20',
          accn: '0000320193-26-000021',
          fy: 2027,
          fp: 'Q1',
        }),
        fact({
          start: '2025-02-03',
          end: '2025-05-04',
          val: 10,
          form: '10-Q',
          filed: '2025-06-01',
          accn: '0000320193-25-000001',
          fy: 2027,
          fp: 'Q1',
        }),
        fact({
          start: '2025-05-05',
          end: '2025-08-03',
          val: 20,
          form: '10-Q',
          filed: '2025-09-01',
          accn: '0000320193-25-000002',
        }),
        fact({
          start: '2025-08-04',
          end: '2025-11-02',
          val: 30,
          form: '10-Q',
          filed: '2025-12-01',
          accn: '0000320193-25-000003',
        }),
      ],
      { fiscalYearEndMonth: 1, asOf: '2026-03-01' },
    );
    expect(result.data.latestAnnual).toMatchObject({
      fiscalYear: 2026,
      revenue: { value: 100 },
    });
    expect(result.data.latestAnnual?.fiscalYear).not.toBe(2027);
    expect(result.data.latestQuarter).toMatchObject({
      fiscalYear: 2026,
      fiscalQuarter: 4,
      derived: true,
      end: '2026-02-01',
      revenue: { value: 40 },
    });
    expect(result.data.ttm?.revenue.value).toBe(100);
    expect(result.data.latestQuarter?.fiscalQuarter).not.toBe(1);
  });

  it('does not treat a spilled annual total as next year Q1 when no quarters exist', () => {
    const result = run(
      [
        fact({
          start: '2025-10-04',
          end: '2026-10-02',
          val: 100,
          form: '10-K',
          filed: '2026-10-20',
          accn: '0000320193-26-000030',
          fy: 2027,
          fp: 'Q1',
        }),
      ],
      { fiscalYearEndMonth: 9, asOf: '2026-11-01' },
    );
    expect(result.data.latestAnnual).toMatchObject({
      fiscalYear: 2026,
      revenue: { value: 100 },
    });
    expect(result.data.latestQuarter).toBeUndefined();
    expect(result.data.ttm?.revenue).toMatchObject({
      available: false,
      reason: 'insufficient_periods',
    });
    expect(result.data.ttm?.revenue.value).toBeUndefined();
  });

  it('does not let a copied filing fp label a quarter that has no chain', () => {
    const result = run(
      [
        fact({
          start: '2024-10-28',
          end: '2025-01-26',
          val: 80,
          filed: '2026-02-25',
          form: '10-K',
          accn: '0000320193-26-000021',
          fy: 2026,
          fp: 'Q1',
        }),
      ],
      { fiscalYearEndMonth: 1, asOf: '2026-03-01' },
    );
    expect(result.data.latestQuarter).toBeUndefined();
    expect(result.data.briefing.join(' ')).toContain('not_comparable');
    expect(JSON.stringify(result.data.latestQuarter ?? {})).not.toContain(
      '"fiscalQuarter":1',
    );
  });
});

describe('period arithmetic', () => {
  it('keeps an amended value only after it is filed and cites the prior value', () => {
    const facts = [
      fact({
        start: '2026-01-01',
        end: '2026-03-31',
        val: 100,
        filed: '2026-05-01',
        form: '10-Q',
        accn: '0000320193-26-000001',
      }),
      fact({
        start: '2026-01-01',
        end: '2026-03-31',
        val: 105,
        filed: '2026-06-01',
        form: '10-Q/A',
        accn: '0000320193-26-000002',
      }),
    ];
    const before = run(facts, { asOf: '2026-05-15' });
    expect(before.data.latestQuarter?.revenue).toMatchObject({
      value: 100,
      restated: undefined,
      citation: { accession: '0000320193-26-000001', filed: '2026-05-01' },
    });
    expect(JSON.stringify(before.data)).not.toContain('105');

    const after = run(facts, { asOf: '2026-07-01' });
    expect(after.data.latestQuarter?.revenue).toMatchObject({
      value: 105,
      restated: true,
      priorValue: 100,
      priorAccession: '0000320193-26-000001',
      priorFiled: '2026-05-01',
      citation: { accession: '0000320193-26-000002', form: '10-Q/A' },
    });
  });

  it('does not mark a repeated identical fact as a restatement', () => {
    const result = run([
      fact({
        start: '2026-01-01',
        end: '2026-03-31',
        val: 100,
        filed: '2026-05-01',
        accn: '0000320193-26-000001',
      }),
      fact({
        start: '2026-01-01',
        end: '2026-03-31',
        val: 100,
        filed: '2026-11-03',
        form: '10-K',
        accn: '0000320193-26-000009',
      }),
    ]);
    expect(result.data.latestQuarter?.revenue).toMatchObject({
      value: 100,
      citation: { accession: '0000320193-26-000009' },
    });
    expect(result.data.latestQuarter?.revenue.restated).toBeUndefined();
  });

  it('does not sum year-to-date facts into a quarter or a trailing total', () => {
    const result = run([
      fact({
        start: '2026-01-01',
        end: '2026-06-30',
        val: 1000,
        accn: '0000320193-26-000011',
      }),
      fact({
        start: '2026-01-01',
        end: '2026-09-30',
        val: 3000,
        accn: '0000320193-26-000012',
      }),
      fact({
        start: '2026-01-01',
        end: '2026-11-15',
        val: 6000,
        accn: '0000320193-26-000013',
      }),
    ]);
    const text = JSON.stringify(result.data);
    expect(result.data.latestQuarter).toBeUndefined();
    expect(result.data.ttm?.revenue).toMatchObject({
      available: false,
      reason: 'insufficient_periods',
    });
    expect(result.data.ttm?.revenue.value).toBeUndefined();
    expect(text).not.toContain('"value":1000');
    expect(text).not.toContain('"value":3000');
    expect(text).not.toContain('"value":6000');
    expect(text).not.toContain('$6,000');
    expect(text).not.toContain('$10,000');
  });

  it('leaves growth unavailable when four quarters or a prior year do not exist', () => {
    const result = run([
      fact({
        start: '2026-01-01',
        end: '2026-03-31',
        val: 10,
        accn: '0000320193-26-000001',
      }),
      fact({
        start: '2026-04-01',
        end: '2026-06-30',
        val: 11,
        accn: '0000320193-26-000002',
      }),
      fact({
        start: '2026-07-01',
        end: '2026-09-30',
        val: 12,
        accn: '0000320193-26-000003',
      }),
    ]);
    expect(result.data.ttm?.revenue.reason).toBe('insufficient_periods');
    expect(result.data.growth?.quarterlyRevenue.reason).toBe(
      'insufficient_periods',
    );
    expect(result.data.growth?.annualRevenue.reason).toBe(
      'insufficient_periods',
    );
    expect(result.data.ttm?.revenue.value).toBeUndefined();
  });

  it('does not divide by a zero prior value or treat missing income as zero', () => {
    const result = run(
      [
        fact({
          start: '2025-01-01',
          end: '2025-12-31',
          val: 0,
          form: '10-K',
          filed: '2026-02-01',
          accn: '0000320193-26-000001',
        }),
        fact({
          start: '2026-01-01',
          end: '2026-12-31',
          val: 10,
          form: '10-K',
          filed: '2027-02-01',
          accn: '0000320193-27-000001',
        }),
        fact({
          concept: 'OperatingIncomeLoss',
          start: '2026-01-01',
          end: '2026-03-31',
          val: 4,
          accn: '0000320193-26-000004',
        }),
        fact({
          start: '2026-01-01',
          end: '2026-03-31',
          val: 0,
          accn: '0000320193-26-000005',
        }),
      ],
      { asOf: '2027-03-01' },
    );
    expect(result.data.latestAnnual?.revenue.value).toBe(10);
    expect(result.data.growth?.annualRevenue).toMatchObject({
      available: false,
      reason: 'zero_denominator',
    });
    expect(result.data.growth?.annualRevenue.value).toBeUndefined();
    expect(result.data.latestQuarter?.revenue).toMatchObject({
      value: 0,
      display: '$0',
    });
    expect(result.data.latestQuarter?.netIncome).toMatchObject({
      available: false,
      reason: 'missing',
    });
    expect(result.data.latestQuarter?.netIncome.value).toBeUndefined();
    expect(result.data.latestQuarter?.operatingMargin).toMatchObject({
      available: false,
      reason: 'zero_denominator',
    });
    expect(
      JSON.stringify(result.data.latestQuarter?.operatingMargin),
    ).not.toContain('"value":0');
    expect(JSON.stringify(result.data)).not.toContain('Infinity');
  });

  it('computes a margin from the same period and refuses mixed currencies', () => {
    const comparable = run([
      fact({
        start: '2026-01-01',
        end: '2026-03-31',
        val: 200,
        accn: '0000320193-26-000001',
      }),
      fact({
        concept: 'OperatingIncomeLoss',
        start: '2026-01-01',
        end: '2026-03-31',
        val: 50,
        accn: '0000320193-26-000002',
      }),
    ]);
    expect(comparable.data.latestQuarter?.operatingMargin).toMatchObject({
      value: 0.25,
      display: '25%',
      formula: 'operating_income / revenue',
    });

    const mixed = run([
      fact({
        start: '2026-01-01',
        end: '2026-03-31',
        val: 100,
        unit: 'EUR',
        accn: '0000320193-26-000001',
      }),
      fact({
        start: '2026-01-01',
        end: '2026-03-31',
        val: 90,
        unit: 'GBP',
        accn: '0000320193-26-000002',
      }),
    ]);
    expect(mixed.data.briefing.join(' ')).toContain('mixed_currency');
    expect(JSON.stringify(mixed.data.latestQuarter ?? {})).not.toContain('190');
    expect(JSON.stringify(mixed.data)).not.toContain('"value":90');
    expect(JSON.stringify(mixed.data)).not.toContain('"value":100');
  });

  it('uses USD when it is present and does not add another currency or a share count', () => {
    const result = run([
      fact({
        start: '2026-01-01',
        end: '2026-03-31',
        val: 100,
        accn: '0000320193-26-000001',
      }),
      fact({
        start: '2026-01-01',
        end: '2026-03-31',
        val: 90,
        unit: 'EUR',
        accn: '0000320193-26-000002',
      }),
      fact({
        start: '2026-04-01',
        end: '2026-06-30',
        val: 200,
        unit: 'EUR',
        accn: '0000320193-26-000003',
      }),
      fact({
        start: '2026-01-01',
        end: '2026-03-31',
        val: 5,
        unit: 'shares',
        accn: '0000320193-26-000004',
      }),
    ]);
    expect(result.data.latestQuarter?.revenue.value).toBe(100);
    expect(JSON.stringify(result.data.latestQuarter)).not.toContain('200');
    expect(JSON.stringify(result.data.latestQuarter?.revenue)).not.toContain(
      '105',
    );
  });

  it('does not combine two different periods that share a quarter start', () => {
    const result = run([
      fact({
        start: '2026-01-01',
        end: '2026-03-25',
        val: 40,
        accn: '0000320193-26-000001',
      }),
      fact({
        start: '2026-01-01',
        end: '2026-03-31',
        val: 70,
        accn: '0000320193-26-000002',
      }),
    ]);
    expect(result.data.latestQuarter).toBeUndefined();
    expect(result.data.ttm?.revenue.reason).toBe('not_comparable');
    expect(JSON.stringify(result.data)).not.toContain('110');
    expect(JSON.stringify(result.data)).not.toContain('"value":40');
    expect(JSON.stringify(result.data)).not.toContain('"value":70');
  });

  it('withholds an unexplained later value instead of calling it a restatement', () => {
    const period = {
      start: '2025-09-28',
      end: '2025-12-27',
    };
    const result = run(
      [
        fact({
          ...period,
          val: 143756000000,
          filed: '2026-01-30',
          form: '10-Q',
          accn: '0000320193-26-000006',
        }),
        fact({
          ...period,
          val: 9000000000,
          filed: '2026-02-15',
          form: '10-Q',
          accn: '0000320193-26-000007',
        }),
      ],
      { fiscalYearEndMonth: 9, asOf: '2026-03-01' },
    );
    const text = JSON.stringify(result.data);
    expect(text).not.toContain('9000000000');
    expect(text).not.toContain('143756000000');
    expect(text).not.toContain('restated');
    expect(result.data.briefing.join(' ')).toContain('not_comparable');
    const before = run(
      [
        fact({
          ...period,
          val: 143756000000,
          filed: '2026-01-30',
          form: '10-Q',
          accn: '0000320193-26-000006',
        }),
        fact({
          ...period,
          val: 9000000000,
          filed: '2026-02-15',
          form: '10-Q',
          accn: '0000320193-26-000007',
        }),
      ],
      { fiscalYearEndMonth: 9, asOf: '2026-02-01' },
    );
    expect(before.data.latestQuarter?.revenue.value).toBe(143756000000);
    expect(JSON.stringify(before.data)).not.toContain('9000000000');
  });

  it('keeps an amending form as a restatement and ignores a repeated comparative', () => {
    const amended = run([
      fact({
        start: '2026-01-01',
        end: '2026-03-31',
        val: 100,
        filed: '2026-05-01',
        form: '10-Q',
        accn: '0000320193-26-000001',
      }),
      fact({
        start: '2026-01-01',
        end: '2026-03-31',
        val: 105,
        filed: '2026-06-01',
        form: '10-Q/A',
        accn: '0000320193-26-000002',
      }),
    ]);
    expect(amended.data.latestQuarter?.revenue).toMatchObject({
      value: 105,
      restated: true,
      priorValue: 100,
      priorAccession: '0000320193-26-000001',
    });
  });

  it('marks filings stale when the newest periodic report is older than 120 days', () => {
    const result = normalizeFinancials({
      name: 'Apple',
      ticker: 'AAPL',
      cik: CIK,
      fiscalYearEndMonth: 12,
      asOf: '2026-11-08',
      facts: [],
      filings: [
        {
          form: '10-Q',
          filed: '2026-01-01',
          accession: '0000320193-26-000001',
          sourceUrl:
            'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/0000320193-26-000001-index.html',
        },
      ],
    });
    expect(result.filingCadence).toBe('stale');
    expect(result.data.briefing.join(' ')).toContain('older than 120 days');
  });
});

describe('NVDA companyfacts concept switch', () => {
  const NVDA = '0001045810';

  function row(
    concept: string,
    partial: Partial<NormalizedFactInput> &
      Pick<NormalizedFactInput, 'start' | 'end' | 'val' | 'accn' | 'filed'>,
  ) {
    return {
      concept,
      unit: 'USD',
      form: '10-Q',
      fy: 2020,
      fp: 'FY',
      ...partial,
    };
  }

  /**
   * Reduced companyfacts document. The old revenue tag stops at FY2022 while
   * Revenues continues through FY2027 Q2. Values match NVIDIA's filed figures.
   * Frame duplicates repeat the same amount; the later filing should win.
   */
  function nvdaFacts() {
    const old = 'RevenueFromContractWithCustomerExcludingAssessedTax';
    const current = 'Revenues';
    const income = 'NetIncomeLoss';
    const operating = 'OperatingIncomeLoss';
    return readGaapFacts({
      facts: {
        'us-gaap': {
          [old]: {
            units: {
              USD: [
                row(old, {
                  start: '2019-10-28',
                  end: '2020-01-26',
                  val: 3_105_000_000,
                  accn: '0001045810-20-000010',
                  form: '10-K',
                  filed: '2020-02-20',
                  fy: 2099,
                  fp: 'FY',
                  frame: 'CY2019Q4',
                }),
                row(old, {
                  start: '2020-01-27',
                  end: '2021-01-31',
                  val: 16_675_000_000,
                  accn: '0001045810-22-000036',
                  form: '10-K',
                  filed: '2022-03-18',
                  fy: 2022,
                  fp: 'FY',
                  frame: 'CY2020',
                }),
                row(old, {
                  start: '2021-02-01',
                  end: '2022-01-30',
                  val: 26_914_000_000,
                  accn: '0001045810-22-000036',
                  form: '10-K',
                  filed: '2022-03-18',
                  fy: 2022,
                  fp: 'FY',
                  frame: 'CY2021',
                }),
              ],
            },
          },
          [current]: {
            units: {
              USD: [
                row(current, {
                  start: '2021-02-01',
                  end: '2022-01-30',
                  val: 26_914_000_000,
                  accn: '0001045810-24-000012',
                  form: '10-K',
                  filed: '2024-02-21',
                  fy: 2024,
                  fp: 'FY',
                  frame: 'CY2021',
                }),
                row(current, {
                  start: '2024-01-29',
                  end: '2024-04-28',
                  val: 26_044_000_000,
                  accn: '0001045810-24-000124',
                  filed: '2024-05-29',
                  fy: 2025,
                  fp: 'Q1',
                }),
                row(current, {
                  start: '2024-01-29',
                  end: '2024-04-28',
                  val: 26_044_000_000,
                  accn: '0001045810-25-000116',
                  filed: '2025-05-28',
                  fy: 2026,
                  fp: 'Q1',
                  frame: 'CY2024Q1',
                }),
                row(current, {
                  start: '2024-04-29',
                  end: '2024-07-28',
                  val: 30_040_000_000,
                  accn: '0001045810-25-000209',
                  filed: '2025-08-27',
                  fy: 2026,
                  fp: 'Q2',
                  frame: 'CY2024Q2',
                }),
                row(current, {
                  start: '2024-07-29',
                  end: '2024-10-27',
                  val: 35_082_000_000,
                  accn: '0001045810-25-000230',
                  filed: '2025-11-19',
                  fy: 2026,
                  fp: 'Q3',
                  frame: 'CY2024Q3',
                }),
                row(current, {
                  start: '2024-01-29',
                  end: '2025-01-26',
                  val: 130_497_000_000,
                  accn: '0001045810-25-000023',
                  form: '10-K',
                  filed: '2025-02-26',
                  fy: 2025,
                  fp: 'FY',
                }),
                row(current, {
                  start: '2024-01-29',
                  end: '2025-01-26',
                  val: 130_497_000_000,
                  accn: '0001045810-26-000021',
                  form: '10-K',
                  filed: '2026-02-25',
                  fy: 2026,
                  fp: 'FY',
                  frame: 'CY2024',
                }),
                row(current, {
                  start: '2025-01-27',
                  end: '2025-04-27',
                  val: 44_062_000_000,
                  accn: '0001045810-26-000052',
                  filed: '2026-05-20',
                  fy: 2027,
                  fp: 'Q1',
                  frame: 'CY2025Q1',
                }),
                row(current, {
                  start: '2025-04-28',
                  end: '2025-07-27',
                  val: 46_743_000_000,
                  accn: '0001045810-26-000075',
                  filed: '2026-08-26',
                  fy: 2027,
                  fp: 'Q2',
                  frame: 'CY2025Q2',
                }),
                row(current, {
                  start: '2025-07-28',
                  end: '2025-10-26',
                  val: 57_006_000_000,
                  accn: '0001045810-25-000230',
                  filed: '2025-11-19',
                  fy: 2026,
                  fp: 'Q3',
                  frame: 'CY2025Q3',
                }),
                row(current, {
                  start: '2025-01-27',
                  end: '2026-01-25',
                  val: 215_938_000_000,
                  accn: '0001045810-26-000021',
                  form: '10-K',
                  filed: '2026-02-25',
                  fy: 2026,
                  fp: 'FY',
                  frame: 'CY2025',
                }),
                row(current, {
                  start: '2026-01-26',
                  end: '2026-04-26',
                  val: 81_615_000_000,
                  accn: '0001045810-26-000052',
                  filed: '2026-05-20',
                  fy: 2027,
                  fp: 'Q1',
                  frame: 'CY2026Q1',
                }),
                row(current, {
                  start: '2026-04-27',
                  end: '2026-07-26',
                  val: 96_221_000_000,
                  accn: '0001045810-26-000070',
                  filed: '2026-08-20',
                  fy: 2020,
                  fp: 'Q1',
                }),
                row(current, {
                  start: '2026-04-27',
                  end: '2026-07-26',
                  val: 96_221_000_000,
                  accn: '0001045810-26-000075',
                  filed: '2026-08-26',
                  fy: 2027,
                  fp: 'Q2',
                  frame: 'CY2026Q2',
                }),
              ],
            },
          },
          [income]: {
            units: {
              USD: [
                row(income, {
                  start: '2025-01-27',
                  end: '2025-04-27',
                  val: 18_775_000_000,
                  accn: '0001045810-26-000052',
                  filed: '2026-05-20',
                }),
                row(income, {
                  start: '2025-04-28',
                  end: '2025-07-27',
                  val: 26_422_000_000,
                  accn: '0001045810-26-000075',
                  filed: '2026-08-26',
                }),
                row(income, {
                  start: '2025-07-28',
                  end: '2025-10-26',
                  val: 31_910_000_000,
                  accn: '0001045810-25-000230',
                  filed: '2025-11-19',
                }),
                row(income, {
                  start: '2025-01-27',
                  end: '2026-01-25',
                  val: 120_067_000_000,
                  accn: '0001045810-26-000021',
                  form: '10-K',
                  filed: '2026-02-25',
                }),
                row(income, {
                  start: '2026-01-26',
                  end: '2026-04-26',
                  val: 58_321_000_000,
                  accn: '0001045810-26-000052',
                  filed: '2026-05-20',
                }),
                row(income, {
                  start: '2026-04-27',
                  end: '2026-07-26',
                  val: 59_688_000_000,
                  accn: '0001045810-26-000075',
                  filed: '2026-08-26',
                }),
              ],
            },
          },
          [operating]: {
            units: {
              USD: [
                row(operating, {
                  start: '2025-01-27',
                  end: '2025-04-27',
                  val: 21_638_000_000,
                  accn: '0001045810-26-000052',
                  filed: '2026-05-20',
                }),
                row(operating, {
                  start: '2025-04-28',
                  end: '2025-07-27',
                  val: 28_440_000_000,
                  accn: '0001045810-26-000075',
                  filed: '2026-08-26',
                }),
                row(operating, {
                  start: '2025-07-28',
                  end: '2025-10-26',
                  val: 36_010_000_000,
                  accn: '0001045810-25-000230',
                  filed: '2025-11-19',
                }),
                row(operating, {
                  start: '2025-01-27',
                  end: '2026-01-25',
                  val: 130_387_000_000,
                  accn: '0001045810-26-000021',
                  form: '10-K',
                  filed: '2026-02-25',
                }),
                row(operating, {
                  start: '2026-01-26',
                  end: '2026-04-26',
                  val: 53_536_000_000,
                  accn: '0001045810-26-000052',
                  filed: '2026-05-20',
                }),
                row(operating, {
                  start: '2026-04-27',
                  end: '2026-07-26',
                  val: 63_734_000_000,
                  accn: '0001045810-26-000075',
                  filed: '2026-08-26',
                }),
              ],
            },
          },
        },
      },
    });
  }

  it('uses the newest quarter, trailing year, and fiscal year across revenue concepts', () => {
    const result = normalizeFinancials({
      name: 'NVIDIA CORP',
      ticker: 'NVDA',
      cik: NVDA,
      fiscalYearEndMonth: 1,
      asOf: '2026-11-10',
      facts: nvdaFacts(),
      filings: [
        {
          form: '8-K',
          filed: '2026-09-03',
          reportDate: '2026-09-02',
          accession: '0001045810-26-000078',
          sourceUrl:
            'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000078/0001045810-26-000078-index.html',
        },
        {
          form: '10-Q',
          filed: '2026-08-26',
          reportDate: '2026-07-26',
          accession: '0001045810-26-000075',
          sourceUrl:
            'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000075/0001045810-26-000075-index.html',
        },
      ],
    });
    expect(result.data.latestQuarter).toMatchObject({
      fiscalYear: 2027,
      fiscalQuarter: 2,
      start: '2026-04-27',
      end: '2026-07-26',
      revenue: {
        value: 96_221_000_000,
        display: '$96,221,000,000',
        citation: {
          concept: 'Revenues',
          accession: '0001045810-26-000075',
          filed: '2026-08-26',
          form: '10-Q',
        },
      },
      netIncome: { value: 59_688_000_000, display: '$59,688,000,000' },
      operatingMargin: { value: 0.662371, display: '66.24%' },
      revenueGrowth: { value: 1.058511, display: '105.85%' },
    });
    expect(result.data.latestQuarter?.fiscalYear).not.toBe(2020);
    expect(result.data.latestQuarter?.revenue.value).not.toBe(3_105_000_000);
    expect(result.data.ttm).toMatchObject({
      start: '2025-07-28',
      end: '2026-07-26',
      revenue: { value: 302_969_000_000, display: '$302,969,000,000' },
      netIncome: { value: 192_879_000_000 },
      operatingMargin: { value: 0.652143, display: '65.21%' },
      revenueGrowth: { value: 0.833753, display: '83.38%' },
    });
    expect(result.data.ttm?.revenue.value).not.toBe(10_918_000_000);
    expect(
      result.data.ttm?.revenue.inputCitations?.some(
        (item) => item.value === 68_127_000_000 && item.form === '10-K',
      ),
    ).toBe(true);
    expect(result.data.latestAnnual).toMatchObject({
      fiscalYear: 2026,
      start: '2025-01-27',
      end: '2026-01-25',
      revenue: {
        value: 215_938_000_000,
        display: '$215,938,000,000',
        citation: {
          accession: '0001045810-26-000021',
          filed: '2026-02-25',
          form: '10-K',
        },
      },
      netIncome: { value: 120_067_000_000 },
      operatingMargin: { value: 0.603817, display: '60.38%' },
      revenueGrowth: { value: 0.654735, display: '65.47%' },
    });
    expect(result.data.latestAnnual?.revenue.value).not.toBe(26_914_000_000);
    expect(result.data.latestAnnual?.fiscalYear).not.toBe(2022);
    expect(result.publishedAt).toBe('2026-08-26');
    expect(result.publishedAt).not.toBe('2026-09-03');
    const text = result.data.briefing.join('\n');
    expect(text).toContain(
      'Latest quarter FY2027 Q2 (2026-04-27 to 2026-07-26) revenue is $96,221,000,000',
    );
    expect(text).toContain(
      'Full-year FY2026 (2025-01-27 to 2026-01-25) revenue is $215,938,000,000',
    );
    expect(text).toContain(
      'Trailing twelve-month revenue (2025-07-28 to 2026-07-26) is $302,969,000,000',
    );
    expect(text).toContain('changed 65.47% from FY2025');
    expect(text).not.toContain('$3,105,000,000');
    expect(text).not.toContain('$10,918,000,000');
    expect(text).not.toContain('$26,914,000,000');
    expect(text).not.toContain('FY2020');
    expect(text).toContain('[10-Q filed 2026-08-26](https://www.sec.gov/');
    expect(text).not.toMatch(/filed \d{4}-\d{2}-\d{2} \(https:\/\//);
    for (const line of result.data.briefing) {
      expect(line.length).toBeLessThanOrEqual(500);
      expect(line).toMatch(/^[\x20-\x7E]+$/);
    }
    const disclaimer = result.data.briefing.filter((line) =>
      line.includes('not a recommendation'),
    );
    expect(disclaimer).toEqual([
      'Filing facts, not the Oren Score, not a recommendation.',
    ]);
  });

  it('keeps a later revenue concept when the same period disagrees, and ignores fy', () => {
    const result = normalizeFinancials({
      name: 'NVIDIA CORP',
      ticker: 'NVDA',
      cik: NVDA,
      fiscalYearEndMonth: 1,
      asOf: '2026-11-10',
      facts: [
        fact({
          concept: 'RevenueFromContractWithCustomerExcludingAssessedTax',
          start: '2025-02-03',
          end: '2026-01-31',
          val: 3_105_000_000,
          accn: '0001045810-20-000010',
          form: '10-K',
          filed: '2020-02-20',
          fy: 2099,
          fp: 'Q4',
        }),
        fact({
          concept: 'Revenues',
          start: '2025-02-03',
          end: '2026-01-31',
          val: 96_221_000_000,
          accn: '0001045810-26-000075',
          form: '10-K',
          filed: '2026-08-26',
          fy: 2020,
          fp: 'FY',
          frame: 'CY2025',
        }),
      ],
      filings: [],
    });
    expect(result.data.latestAnnual?.revenue).toMatchObject({
      value: 96_221_000_000,
      citation: {
        concept: 'Revenues',
        accession: '0001045810-26-000075',
        filed: '2026-08-26',
      },
    });
    expect(result.data.latestAnnual?.fiscalYear).toBe(2026);
    expect(result.data.latestAnnual?.revenue.restated).toBeUndefined();
    expect(JSON.stringify(result.data.latestAnnual)).not.toContain(
      '3105000000',
    );
  });
});

describe('MSFT-shaped revenue tags', () => {
  it('keeps the current contract-revenue tag when older Revenues and SalesRevenueNet facts exist', () => {
    const result = normalizeFinancials({
      name: 'Microsoft',
      ticker: 'MSFT',
      cik: '0000789019',
      fiscalYearEndMonth: 6,
      asOf: '2026-11-10',
      facts: [
        fact({
          concept: 'Revenues',
          start: '2009-07-01',
          end: '2010-06-30',
          val: 62_484_000_000,
          accn: '0001193125-10-000001',
          form: '10-K',
          filed: '2010-07-30',
          fy: 2010,
          fp: 'FY',
        }),
        fact({
          concept: 'SalesRevenueNet',
          start: '2017-07-01',
          end: '2018-06-30',
          val: 110_360_000_000,
          accn: '0001564590-18-000001',
          form: '10-K',
          filed: '2018-08-03',
          fy: 2018,
          fp: 'FY',
        }),
        fact({
          concept: 'RevenueFromContractWithCustomerExcludingAssessedTax',
          start: '2025-07-01',
          end: '2026-06-30',
          val: 281_724_000_000,
          accn: '0000789019-26-000001',
          form: '10-K',
          filed: '2026-07-30',
          fy: 2026,
          fp: 'FY',
        }),
        fact({
          concept: 'RevenueFromContractWithCustomerExcludingAssessedTax',
          start: '2026-07-01',
          end: '2026-09-30',
          val: 77_673_000_000,
          accn: '0000789019-26-000010',
          form: '10-Q',
          filed: '2026-10-29',
          fy: 2027,
          fp: 'Q1',
        }),
      ],
      filings: [],
    });
    expect(result.data.latestQuarter).toMatchObject({
      fiscalYear: 2027,
      fiscalQuarter: 1,
      end: '2026-09-30',
      revenue: { value: 77_673_000_000 },
    });
    expect(result.data.latestAnnual).toMatchObject({
      fiscalYear: 2026,
      end: '2026-06-30',
      revenue: { value: 281_724_000_000 },
    });
    expect(result.data.latestAnnual?.revenue.value).not.toBe(62_484_000_000);
    expect(result.data.latestAnnual?.revenue.value).not.toBe(110_360_000_000);
  });
});

describe('same filing, two revenue tags', () => {
  const period = {
    start: '2025-02-03',
    end: '2026-02-01',
    accn: '0000320193-26-000021',
    form: '10-K' as const,
    filed: '2026-02-20',
  };
  const preferred = 'RevenueFromContractWithCustomerExcludingAssessedTax';

  function report(order: 'preferred-first' | 'revenues-first') {
    const preferredFact = fact({
      ...period,
      concept: preferred,
      val: 111,
    });
    const revenuesFact = fact({
      ...period,
      concept: 'Revenues',
      val: 222,
    });
    return run(
      order === 'preferred-first'
        ? [preferredFact, revenuesFact]
        : [revenuesFact, preferredFact],
      { fiscalYearEndMonth: 1, asOf: '2026-03-01' },
    );
  }

  it.each(['preferred-first', 'revenues-first'] as const)(
    'keeps the earlier GAAP alias when %s',
    (order) => {
      const result = report(order);
      expect(result.data.latestAnnual?.revenue).toMatchObject({
        value: 111,
        citation: { concept: preferred, accession: period.accn },
      });
      expect(result.data.latestAnnual?.revenue.value).not.toBe(222);
      expect(JSON.stringify(result.data.latestAnnual)).not.toContain('222');
    },
  );
});

describe('mixed revenue tags across a year', () => {
  const contract = 'RevenueFromContractWithCustomerExcludingAssessedTax';

  it('does not derive Q4 from a full year and quarters that use different tags', () => {
    const result = run(
      [
        fact({
          concept: 'Revenues',
          start: '2025-02-03',
          end: '2026-02-01',
          val: 1000,
          form: '10-K',
          filed: '2026-02-20',
          accn: '0000320193-26-000010',
        }),
        fact({
          concept: contract,
          start: '2025-02-03',
          end: '2025-05-04',
          val: 10,
          accn: '0000320193-25-000001',
          filed: '2025-06-01',
        }),
        fact({
          concept: contract,
          start: '2025-05-05',
          end: '2025-08-03',
          val: 20,
          accn: '0000320193-25-000002',
          filed: '2025-09-01',
        }),
        fact({
          concept: contract,
          start: '2025-08-04',
          end: '2025-11-02',
          val: 30,
          accn: '0000320193-25-000003',
          filed: '2025-12-01',
        }),
      ],
      { fiscalYearEndMonth: 1, asOf: '2026-03-01' },
    );
    expect(result.data.latestAnnual?.revenue.value).toBe(1000);
    expect(result.data.latestQuarter).toMatchObject({
      fiscalQuarter: 3,
      end: '2025-11-02',
      derived: undefined,
      revenue: { value: 30, citation: { concept: contract } },
    });
    expect(result.data.ttm?.revenue).toMatchObject({
      available: false,
      reason: 'insufficient_periods',
    });
    expect(JSON.stringify(result.data)).not.toContain('"value":940');
    expect(JSON.stringify(result.data)).not.toContain('"value":60');
  });

  it('does not sum a trailing year or a margin across different revenue tags', () => {
    const quarters = [
      ['2025-02-03', '2025-05-04', 10, contract, '0000320193-25-000001'],
      ['2025-05-05', '2025-08-03', 20, contract, '0000320193-25-000002'],
      ['2025-08-04', '2025-11-02', 30, 'Revenues', '0000320193-25-000003'],
      ['2025-11-03', '2026-02-01', 40, 'Revenues', '0000320193-26-000004'],
    ] as const;
    const result = run(
      [
        ...quarters.flatMap(([start, end, val, concept, accn]) => [
          fact({
            concept,
            start,
            end,
            val,
            accn,
            filed: '2026-02-20',
            form: end === '2026-02-01' ? '10-K' : '10-Q',
          }),
          fact({
            concept: 'OperatingIncomeLoss',
            start,
            end,
            val: 5,
            accn:
              accn === '0000320193-26-000004'
                ? '0000320193-26-000014'
                : accn.replace('00000', '00009'),
            filed: '2026-02-20',
            form: end === '2026-02-01' ? '10-K' : '10-Q',
          }),
        ]),
      ],
      { fiscalYearEndMonth: 1, asOf: '2026-03-01' },
    );
    expect(result.data.latestQuarter?.revenue).toMatchObject({
      value: 40,
      citation: { concept: 'Revenues' },
    });
    expect(result.data.ttm?.revenue).toMatchObject({
      available: false,
      reason: 'not_comparable',
    });
    expect(result.data.ttm?.revenue.value).toBeUndefined();
    expect(result.data.ttm?.operatingMargin).toMatchObject({
      available: false,
      reason: 'not_comparable',
    });
    expect(result.data.ttm?.operatingMargin?.value).toBeUndefined();
    const text = JSON.stringify(result.data);
    expect(text).not.toContain('"value":100');
    expect(text).not.toContain('20%');
  });
});
