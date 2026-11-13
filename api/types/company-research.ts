export type CompanyCoverage =
  | 'verified'
  | 'fund'
  | 'foreign'
  | 'unmapped'
  | 'ambiguous'
  | 'mint_mismatch'
  | 'identity_mismatch';

export type CompanyMetricReason =
  | 'missing'
  | 'insufficient_periods'
  | 'zero_denominator'
  | 'mixed_currency'
  | 'not_comparable';

/** A number that appears in one SEC fact, or an input to a derived figure. */
export interface CompanyCitation {
  concept: string;
  form: string;
  accession: string;
  filed: string;
  periodStart?: string;
  periodEnd: string;
  sourceUrl: string;
  unit: string;
  value: number;
}

export interface CompanyMetric {
  available: boolean;
  reason?: CompanyMetricReason;
  /** Deterministic figure. Absent when unavailable. Never coerced from missing to 0. */
  value?: number;
  unit?: string;
  display?: string;
  derived?: boolean;
  formula?: string;
  restated?: boolean;
  priorValue?: number;
  priorAccession?: string;
  priorFiled?: string;
  citation?: CompanyCitation;
  inputCitations?: CompanyCitation[];
}

export interface CompanyPeriod {
  fiscalYear: number;
  fiscalQuarter?: number;
  start: string;
  end: string;
  derived?: boolean;
  revenue: CompanyMetric;
  netIncome: CompanyMetric;
  operatingMargin?: CompanyMetric;
  revenueGrowth?: CompanyMetric;
}

export interface CompanyFiling {
  form: string;
  filed: string;
  reportDate?: string;
  acceptedAt?: string;
  accession: string;
  sourceUrl: string;
  /** 8-K item codes such as 2.02. Omitted unless the value is only item numbers. */
  items?: string;
}

export interface CompanyLink {
  label: string;
  url: string;
}

export interface CompanyResearchData {
  coverage: CompanyCoverage;
  detail?: string;
  identity?: {
    assetId: string;
    ticker: string;
    name: string;
    cik: string;
    secName: string;
    fiscalYearEndMonth: number;
    mints: string[];
    issuerVariant: string;
  };
  latestQuarter?: CompanyPeriod;
  latestAnnual?: CompanyPeriod;
  ttm?: {
    revenue: CompanyMetric;
    netIncome: CompanyMetric;
    operatingMargin?: CompanyMetric;
    /** Current trailing twelve months compared with the prior trailing twelve months. */
    revenueGrowth?: CompanyMetric;
    /** Start of the oldest quarter in the trailing window. */
    start?: string;
    /** End of the newest quarter in the trailing window. */
    end?: string;
  };
  growth?: { quarterlyRevenue: CompanyMetric; annualRevenue: CompanyMetric };
  position?: {
    cash: CompanyMetric;
    assets: CompanyMetric;
    liabilities: CompanyMetric;
  };
  filings: CompanyFiling[];
  links: CompanyLink[];
  briefing: string[];
  filingCadence?: 'current' | 'stale';
  filingsNote?: string;
}
