import type { CompanyFiling } from '../../../types/company-research';
import {
  ACCESSION_PATTERN,
  filingIndexUrl,
  GAAP_CONCEPTS,
  type NormalizedFactInput,
} from './financials';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ACCEPTED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const ITEM_CODES = /^(\d{1,2}\.\d{2})(,\d{1,2}\.\d{2})*$/;
const PERIODIC = new Set(['10-K', '10-Q', '10-K/A', '10-Q/A', '8-K', '8-K/A']);
const WITHHELD =
  'SEC filing metadata was withheld because the submissions list was internally inconsistent.';

export interface SubmissionRead {
  cik?: string;
  name?: string;
  tickers: string[];
  fiscalMonth?: number;
  filings: CompanyFiling[];
  filingsNote?: string;
}

export function readGaapFacts(doc: unknown): NormalizedFactInput[] {
  if (!isRecord(doc) || !isRecord(doc.facts)) return [];
  const gaap = doc.facts['us-gaap'];
  if (!isRecord(gaap)) return [];
  const facts: NormalizedFactInput[] = [];
  for (const [concept, node] of Object.entries(gaap)) {
    if (
      !GAAP_CONCEPTS.has(concept) ||
      !isRecord(node) ||
      !isRecord(node.units)
    ) {
      continue;
    }
    for (const [unit, rows] of Object.entries(node.units)) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const fact = readFact(concept, unit, row);
        if (fact) facts.push(fact);
      }
    }
  }
  return facts;
}

export function readSubmission(doc: unknown, asOf: string): SubmissionRead {
  if (!isRecord(doc)) {
    return { tickers: [], filings: [], filingsNote: WITHHELD };
  }
  const tickers = Array.isArray(doc.tickers)
    ? doc.tickers.filter(
        (ticker): ticker is string => typeof ticker === 'string',
      )
    : [];
  return {
    cik: normalizeCik(doc.cik),
    name: typeof doc.name === 'string' ? doc.name : undefined,
    tickers,
    fiscalMonth: fiscalMonth(doc.fiscalYearEnd),
    ...readFilings(doc.filings, normalizeCik(doc.cik), asOf),
  };
}

export function normalizeCik(value: unknown): string | undefined {
  const raw =
    typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const digits = raw.replace(/\D/g, '');
  if (!digits || digits.length > 10) return undefined;
  return digits.padStart(10, '0');
}

function readFact(
  concept: string,
  unit: string,
  row: unknown,
): NormalizedFactInput | undefined {
  if (
    !isRecord(row) ||
    typeof row.end !== 'string' ||
    typeof row.filed !== 'string'
  ) {
    return undefined;
  }
  if (typeof row.val !== 'number' || typeof row.accn !== 'string')
    return undefined;
  return {
    concept,
    unit,
    start: typeof row.start === 'string' ? row.start : undefined,
    end: row.end,
    val: row.val,
    accn: row.accn,
    form: typeof row.form === 'string' ? row.form : undefined,
    filed: row.filed,
    fy: typeof row.fy === 'number' ? row.fy : undefined,
    fp: typeof row.fp === 'string' ? row.fp : undefined,
    frame: typeof row.frame === 'string' ? row.frame : undefined,
  };
}

function readFilings(
  filings: unknown,
  cik: string | undefined,
  asOf: string,
): { filings: CompanyFiling[]; filingsNote?: string } {
  const recent = isRecord(filings) ? filings.recent : undefined;
  if (!isRecord(recent) || !cik) return { filings: [] };
  const accession = strings(recent.accessionNumber);
  const filed = strings(recent.filingDate);
  const forms = strings(recent.form);
  if (
    accession === undefined ||
    filed === undefined ||
    forms === undefined ||
    accession.length !== filed.length ||
    accession.length !== forms.length
  ) {
    return { filings: [], filingsNote: WITHHELD };
  }
  const reportDate = optionalStrings(recent.reportDate, accession.length);
  const accepted = optionalStrings(recent.acceptanceDateTime, accession.length);
  const items = optionalStrings(recent.items, accession.length);
  if (
    reportDate === 'mismatch' ||
    accepted === 'mismatch' ||
    items === 'mismatch'
  ) {
    return { filings: [], filingsNote: WITHHELD };
  }
  const parsed: CompanyFiling[] = [];
  for (let index = 0; index < accession.length; index++) {
    const form = forms[index];
    const filingDate = filed[index];
    const accessionNumber = accession[index];
    if (!PERIODIC.has(form) || !DATE.test(filingDate) || filingDate > asOf)
      continue;
    if (!ACCESSION_PATTERN.test(accessionNumber)) continue;
    const sourceUrl = filingIndexUrl(cik, accessionNumber);
    if (!sourceUrl) continue;
    const item = items?.[index];
    const reported = reportDate?.[index];
    const acceptedAt = accepted?.[index];
    parsed.push({
      form,
      filed: filingDate,
      accession: accessionNumber,
      sourceUrl,
      reportDate: reported && DATE.test(reported) ? reported : undefined,
      acceptedAt:
        acceptedAt && ACCEPTED.test(acceptedAt) ? acceptedAt : undefined,
      items:
        item && ITEM_CODES.test(item) && item.length <= 40 ? item : undefined,
    });
  }
  return {
    filings: parsed
      .sort(
        (a, b) =>
          b.filed.localeCompare(a.filed) ||
          b.accession.localeCompare(a.accession),
      )
      .slice(0, 8),
  };
}

function fiscalMonth(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d{4}$/.test(value)) return undefined;
  const month = Number(value.slice(0, 2));
  return month >= 1 && month <= 12 ? month : undefined;
}

function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return undefined;
  }
  return value as string[];
}

function optionalStrings(
  value: unknown,
  length: number,
): Array<string | undefined> | 'mismatch' | undefined {
  if (value === undefined) return undefined;
  const parsed = strings(value);
  if (!parsed || parsed.length !== length) return 'mismatch';
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
