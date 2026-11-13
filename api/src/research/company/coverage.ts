/**
 * Verified company coverage for Oren's tokens.xyz stock universe.
 *
 * Observed 2026-11-08 from the public catalog
 * `GET https://api.oren.finance/api/stocks` (403 assets: 401 equity, 2 etf).
 * Stock detail, including the mint, was read the same day from
 * `GET /api/stocks/{assetId}`. That response is the tokens.xyz-backed equity
 * Oren serves. A mint is accepted only when the live equity still carries it.
 *
 * SEC identity was read the same day from
 * `https://www.sec.gov/files/company_tickers.json` and
 * `https://data.sec.gov/submissions/CIK##########.json`.
 * A row is included only when the ticker matched exactly one SEC row and the
 * SEC title agreed with that row. Fiscal-year-end month is the submissions
 * `fiscalYearEnd` month.
 *
 * Not verified, and therefore not given a CIK here:
 * - `spacex` / SPCX. The catalog logo is a Backpack pre-stock. SEC ticker SPCX
 *   is CIK 0001181412, SPACE EXPLORATION TECHNOLOGIES CORP. The mint was not
 *   verified as that listed security, so the names are not joined.
 * - Duplicate catalog tickers CORZ, HUT, and PL (two asset ids each).
 * - Foreign filers such as BABA (20-F, incorporation K3), except the explicit
 *   no-coverage row below, which states the exclusion and does not load facts.
 * - Funds. QQQ has no operating-company CIK in company_tickers.json.
 */

export interface VerifiedCompany {
  assetId: string;
  ticker: string;
  orenName: string;
  secName: string;
  cik: string;
  fiscalYearEndMonth: number;
  mints: readonly string[];
  /** Descriptive only. The live `issuer` label is not a join key. */
  issuerVariant: string;
}

export interface CoverageExclusion {
  assetId: string;
  ticker: string;
  orenName: string;
  mints: readonly string[];
  reason: 'fund_no_statements' | 'no_coverage';
  detail: 'etf' | 'foreign_private_issuer';
}

export interface CoverageRegistry {
  verified: readonly VerifiedCompany[];
  excluded: readonly CoverageExclusion[];
}

export const VERIFIED_COMPANIES: readonly VerifiedCompany[] = [
  {
    assetId: 'apple',
    ticker: 'AAPL',
    orenName: 'Apple',
    secName: 'Apple Inc.',
    cik: '0000320193',
    fiscalYearEndMonth: 9,
    mints: ['AAPLEDt8RpzPgXyhvFzkMBofvFSQw9gpeMCoUdPdLnB8'],
    issuerVariant: 'Backpack Securities',
  },
  {
    assetId: 'nvidia',
    ticker: 'NVDA',
    orenName: 'NVIDIA',
    secName: 'NVIDIA CORP',
    cik: '0001045810',
    fiscalYearEndMonth: 1,
    mints: ['NVDAVuiB7hwd3m5Wa1JuHNovPaPG6BH1QNztbKFxNjv'],
    issuerVariant: 'Backpack Securities',
  },
  {
    assetId: 'microsoft',
    ticker: 'MSFT',
    orenName: 'Microsoft',
    secName: 'MICROSOFT CORP',
    cik: '0000789019',
    fiscalYearEndMonth: 6,
    mints: ['MSFThX899B1DddH5jkyMpdArWXzP85VXLYDrbGGcRJM'],
    issuerVariant: 'Backpack Securities',
  },
];

export const COVERAGE_EXCLUSIONS: readonly CoverageExclusion[] = [
  {
    assetId: 'invesco-qqq',
    ticker: 'QQQ',
    orenName: 'Invesco QQQ',
    mints: ['HrYNm6jTQ71LoFphjVKBTdAE4uja7WsmLG8VxB8ondo'],
    reason: 'fund_no_statements',
    detail: 'etf',
  },
  {
    assetId: 'alibaba',
    ticker: 'BABA',
    orenName: 'Alibaba',
    mints: ['BABANGA4JE7Kkam4nTrALAwAVgsNJUuFJnnkF7S16BZp'],
    reason: 'no_coverage',
    detail: 'foreign_private_issuer',
  },
];

export const DEFAULT_COVERAGE: CoverageRegistry = {
  verified: VERIFIED_COMPANIES,
  excluded: COVERAGE_EXCLUSIONS,
};

export function validateRegistry(registry: CoverageRegistry): void {
  const assetIds = new Set<string>();
  const mints = new Set<string>();
  for (const row of [...registry.verified, ...registry.excluded]) {
    if (assetIds.has(row.assetId)) {
      throw new Error(`Duplicate coverage asset ${row.assetId}`);
    }
    assetIds.add(row.assetId);
    if (!/^\d{10}$/.test('cik' in row ? row.cik : '0000000000')) {
      throw new Error(`Invalid CIK for ${row.assetId}`);
    }
    for (const mint of row.mints) {
      if (mints.has(mint)) throw new Error(`Duplicate coverage mint ${mint}`);
      mints.add(mint);
    }
  }
  for (const row of registry.verified) {
    if (row.fiscalYearEndMonth < 1 || row.fiscalYearEndMonth > 12) {
      throw new Error(`Invalid fiscal year end for ${row.assetId}`);
    }
  }
}

validateRegistry(DEFAULT_COVERAGE);
