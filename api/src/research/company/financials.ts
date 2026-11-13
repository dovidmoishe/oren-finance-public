import type {
  CompanyCitation,
  CompanyFiling,
  CompanyMetric,
  CompanyMetricReason,
  CompanyPeriod,
  CompanyResearchData,
} from '../../../types/company-research';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;
const ACCESSION = ACCESSION_PATTERN;
const FORMS = new Set([
  '10-K',
  '10-Q',
  '10-K/A',
  '10-Q/A',
  '8-K',
  '8-K/A',
  '20-F',
  '40-F',
  '6-K',
]);

export const GAAP_ALIASES = {
  revenue: [
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
    'Revenues',
    'SalesRevenueNet',
  ],
  netIncome: ['NetIncomeLoss'],
  operatingIncome: ['OperatingIncomeLoss'],
  assets: ['Assets'],
  liabilities: ['Liabilities'],
  cash: ['CashAndCashEquivalentsAtCarryingValue'],
} as const;

export const GAAP_CONCEPTS = new Set<string>(
  Object.values(GAAP_ALIASES).flat(),
);

export interface NormalizedFactInput {
  concept: string;
  unit: string;
  start?: string;
  end: string;
  val: number;
  accn: string;
  form?: string;
  filed: string;
  /** Present on SEC facts. Not used to label a period or choose a value. */
  fy?: number;
  fp?: string;
  frame?: string;
}

type Span = 'instant' | 'quarter' | 'ytd' | 'year' | 'irregular';
type Quarter = 1 | 2 | 3 | 4;

interface Point {
  concept: string;
  unit: string;
  start?: string;
  end: string;
  val: number;
  accn: string;
  form: string;
  filed: string;
  sourceUrl: string;
  span: Span;
  fiscalYear: number;
  fiscalQuarter: Quarter;
  restated: boolean;
  priorValue?: number;
  priorAccession?: string;
  priorFiled?: string;
  derived?: boolean;
  formula?: string;
  inputs?: Point[];
}

type Series =
  | {
      kind: 'points';
      points: Point[];
      unit: string;
      /** A newer quarter or the annual fact had no single comparable value. */
      refusedLatest: boolean;
      refusedAnnual: boolean;
    }
  | { kind: 'mixed' }
  | { kind: 'empty' };

const PERIODIC_FORMS = new Set(['10-Q', '10-K', '10-Q/A', '10-K/A']);
/** A 52/53-week year can end a few days outside the fiscal-year-end month. */
const FISCAL_SPILL_DAYS = 7;

export function filingIndexUrl(
  cik: string,
  accession: string,
): string | undefined {
  if (!/^\d{10}$/.test(cik) || !ACCESSION.test(accession)) return undefined;
  const folder = accession.replaceAll('-', '');
  if (!/^\d{18}$/.test(folder)) return undefined;
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${folder}/${accession}-index.html`;
}

/**
 * Fiscal year of an annual period end. Matches the configured fiscal-year-end
 * month, allowing a 52/53-week spill of up to seven days into the next month.
 * Returns undefined when the end is not near exactly one such month.
 * Quarter labels are not derived here.
 */
export function fiscalYearForAnnualEnd(
  end: string,
  fiscalYearEndMonth: number,
): number | undefined {
  const endDay = dayNumber(end);
  if (
    endDay === undefined ||
    fiscalYearEndMonth < 1 ||
    fiscalYearEndMonth > 12
  ) {
    return undefined;
  }
  const year = Number(end.slice(0, 4));
  const hits: number[] = [];
  for (const candidate of [year - 1, year, year + 1]) {
    const anchor = dayNumber(lastDayOfMonth(candidate, fiscalYearEndMonth));
    if (anchor === undefined) continue;
    if (Math.abs(endDay - anchor) <= FISCAL_SPILL_DAYS) hits.push(candidate);
  }
  return hits.length === 1 ? hits[0] : undefined;
}

export function normalizeFinancials(input: {
  name: string;
  ticker: string;
  cik: string;
  fiscalYearEndMonth: number;
  asOf: string;
  facts: NormalizedFactInput[];
  filings: CompanyFiling[];
  filingsNote?: string;
}): {
  publishedAt?: string;
  filingCadence: 'current' | 'stale';
  data: Omit<CompanyResearchData, 'coverage' | 'identity' | 'detail'>;
} {
  const asOf = input.asOf.slice(0, 10);
  const revenue = seriesFor(
    input.facts,
    GAAP_ALIASES.revenue,
    'money',
    asOf,
    input.fiscalYearEndMonth,
    input.cik,
  );
  const netIncome = seriesFor(
    input.facts,
    GAAP_ALIASES.netIncome,
    'money',
    asOf,
    input.fiscalYearEndMonth,
    input.cik,
  );
  const operatingIncome = seriesFor(
    input.facts,
    GAAP_ALIASES.operatingIncome,
    'money',
    asOf,
    input.fiscalYearEndMonth,
    input.cik,
  );
  const flow = indexFlow(pointsOf(revenue));
  const derived = deriveQ4(flow, unitOf(revenue));
  const incomeFlow = indexFlow(pointsOf(netIncome));
  const incomeDerived = deriveQ4(incomeFlow, unitOf(netIncome));
  const operatingFlow = indexFlow(pointsOf(operatingIncome));
  const operatingDerived = deriveQ4(operatingFlow, unitOf(operatingIncome));
  const quarter =
    revenue.kind === 'points' && revenue.refusedLatest
      ? undefined
      : latestQuarter(flow, derived);
  const year = latestYear(flow.years);
  const priorYear = year && yearPoint(flow.years, year.fiscalYear - 1);
  const sameQuarterPrior = quarter
    ? quarterPoint(
        flow.quarters,
        derived,
        quarter.fiscalYear - 1,
        quarter.fiscalQuarter,
      )
    : undefined;
  const incomeQuarter = quarter
    ? quarterPoint(
        incomeFlow.quarters,
        incomeDerived,
        quarter.fiscalYear,
        quarter.fiscalQuarter,
      )
    : undefined;
  const incomeYear = year
    ? yearPoint(incomeFlow.years, year.fiscalYear)
    : undefined;
  const operatingQuarter = quarter
    ? quarterPoint(
        operatingFlow.quarters,
        operatingDerived,
        quarter.fiscalYear,
        quarter.fiscalQuarter,
      )
    : undefined;
  const operatingYear = year
    ? yearPoint(operatingFlow.years, year.fiscalYear)
    : undefined;
  const alignedIncome = quarter ? aligned(incomeQuarter, quarter) : undefined;
  const alignedOperating = quarter
    ? aligned(operatingQuarter, quarter)
    : undefined;
  const quarterlyGrowth = growth(quarter, sameQuarterPrior);
  const annualGrowth = growth(year, priorYear);
  const latestQuarterPeriod = quarter
    ? periodFrom(quarter, {
        revenue: metricFrom(revenue, quarter),
        netIncome: metricFrom(netIncome, alignedIncome),
        operatingMargin: margin(alignedOperating, quarter),
        revenueGrowth: quarterlyGrowth,
      })
    : undefined;
  const annualRevenue =
    revenue.kind === 'points' && revenue.refusedAnnual
      ? unavailable('not_comparable')
      : metricFrom(revenue, year);
  const latestAnnualPeriod = year
    ? periodFrom(year, {
        revenue: annualRevenue,
        netIncome: annualRevenue.available
          ? metricFrom(netIncome, aligned(incomeYear, year))
          : unavailable(annualRevenue.reason ?? 'not_comparable'),
        operatingMargin: annualRevenue.available
          ? margin(aligned(operatingYear, year), year)
          : unavailable(annualRevenue.reason ?? 'not_comparable'),
        revenueGrowth: annualRevenue.available
          ? annualGrowth
          : unavailable(annualRevenue.reason ?? 'not_comparable'),
      })
    : undefined;
  const revenueWindow = trailingWindow(
    flow.quarters,
    derived,
    revenue.kind === 'points' && revenue.refusedLatest ? undefined : quarter,
  );
  const priorRevenueWindow = trailingWindow(
    flow.quarters,
    derived,
    sameQuarterPrior,
  );
  const incomeWindow = trailingWindow(
    incomeFlow.quarters,
    incomeDerived,
    alignedIncome,
  );
  const operatingWindow = trailingWindow(
    operatingFlow.quarters,
    operatingDerived,
    alignedOperating,
  );
  const ttmRevenue =
    revenue.kind === 'mixed'
      ? unavailable('mixed_currency')
      : revenue.kind === 'points' && revenue.refusedLatest
        ? unavailable('not_comparable')
        : revenueWindow.metric;
  const ttmSpan = spanOf(revenueWindow.parts);
  const ttm = {
    revenue: ttmRevenue,
    netIncome: incomeWindow.metric,
    operatingMargin: marginFromSums(operatingWindow, {
      metric: ttmRevenue,
      parts: revenueWindow.parts,
    }),
    revenueGrowth:
      revenue.kind === 'mixed'
        ? unavailable('mixed_currency')
        : summedGrowth(ttmRevenue, priorRevenueWindow.metric),
    start: ttmSpan.start,
    end: ttmSpan.end,
  };
  const growthMetrics = {
    quarterlyRevenue: quarterlyGrowth,
    annualRevenue: annualGrowth,
  };
  const position = {
    cash: instantMetric(
      seriesFor(
        input.facts,
        GAAP_ALIASES.cash,
        'money',
        asOf,
        input.fiscalYearEndMonth,
        input.cik,
      ),
    ),
    assets: instantMetric(
      seriesFor(
        input.facts,
        GAAP_ALIASES.assets,
        'money',
        asOf,
        input.fiscalYearEndMonth,
        input.cik,
      ),
    ),
    liabilities: instantMetric(
      seriesFor(
        input.facts,
        GAAP_ALIASES.liabilities,
        'money',
        asOf,
        input.fiscalYearEndMonth,
        input.cik,
      ),
    ),
  };
  const filingCadence = cadence(input.filings, asOf);
  const links = collectLinks(
    [
      latestQuarterPeriod?.revenue,
      latestQuarterPeriod?.netIncome,
      latestQuarterPeriod?.operatingMargin,
      latestQuarterPeriod?.revenueGrowth,
      latestAnnualPeriod?.revenue,
      latestAnnualPeriod?.netIncome,
      latestAnnualPeriod?.operatingMargin,
      latestAnnualPeriod?.revenueGrowth,
      ttm.revenue,
      ttm.netIncome,
      ttm.operatingMargin,
      ttm.revenueGrowth,
      position.cash,
      position.assets,
      position.liabilities,
    ],
    input.filings,
  );
  const briefing = briefingLines({
    name: safeLabel(input.name),
    ticker: input.ticker,
    cik: input.cik,
    quarter: latestQuarterPeriod,
    annual: latestAnnualPeriod,
    ttm,
    quarterlyRevenue:
      revenue.kind === 'mixed'
        ? unavailable('mixed_currency')
        : revenue.kind === 'points' && revenue.refusedLatest
          ? unavailable('not_comparable')
          : latestQuarterPeriod?.revenue,
    quarterlyGrowth: growthMetrics.quarterlyRevenue,
    annualGrowth:
      latestAnnualPeriod?.revenueGrowth ?? growthMetrics.annualRevenue,
    margin: latestQuarterPeriod?.operatingMargin,
    annualUnavailable:
      revenue.kind === 'points' && revenue.refusedAnnual
        ? 'not_comparable'
        : undefined,
    cadence: filingCadence,
    filingsNote: input.filingsNote,
  });
  const publishedAt =
    latestDate(
      [
        latestQuarterPeriod?.revenue,
        latestQuarterPeriod?.netIncome,
        latestAnnualPeriod?.revenue,
        latestAnnualPeriod?.netIncome,
        ttm.revenue,
        ttm.netIncome,
      ].flatMap(citedFiled),
    ) ??
    latestDate(
      input.filings
        .filter((filing) =>
          ['10-K', '10-Q', '10-K/A', '10-Q/A'].includes(filing.form),
        )
        .map((filing) => filing.filed),
    );
  return {
    publishedAt,
    filingCadence,
    data: {
      latestQuarter: latestQuarterPeriod,
      latestAnnual: latestAnnualPeriod,
      ttm,
      growth: growthMetrics,
      position,
      filings: input.filings,
      links,
      briefing,
      filingCadence,
      filingsNote: input.filingsNote,
    },
  };
}

function aligned(point: Point | undefined, expected: Point): Point | undefined {
  if (!point) return undefined;
  if (point.start !== expected.start || point.end !== expected.end)
    return undefined;
  return point;
}

function periodFrom(
  point: Point,
  metrics: {
    revenue: CompanyMetric;
    netIncome: CompanyMetric;
    operatingMargin?: CompanyMetric;
    revenueGrowth?: CompanyMetric;
  },
): CompanyPeriod {
  return {
    fiscalYear: point.fiscalYear,
    fiscalQuarter: point.span === 'quarter' ? point.fiscalQuarter : undefined,
    start: point.start ?? point.end,
    end: point.end,
    derived: point.derived,
    ...metrics,
  };
}

function seriesFor(
  facts: NormalizedFactInput[],
  aliases: readonly string[],
  kind: 'money',
  asOf: string,
  fiscalYearEndMonth: number,
  cik: string,
): Series {
  // A filer changes revenue tags over time (SalesRevenueNet, then
  // RevenueFromContractWithCustomerExcludingAssessedTax, then Revenues).
  // The first tag that has any fact is often the stale one, so every alias
  // is merged and each period keeps the latest filing.
  const aliasSet = new Set<string>(aliases);
  const rows = facts.filter(
    (fact) => aliasSet.has(fact.concept) && usable(fact, asOf, cik),
  );
  if (!rows.length) return { kind: 'empty' };
  const chosen = chooseUnit(
    rows.map((row) => row.unit),
    kind,
  );
  if (chosen === 'mixed') return { kind: 'mixed' };
  if (!chosen) return { kind: 'empty' };
  const collapsed = collapse(
    rows.filter((row) => row.unit === chosen),
    chosen,
    cik,
    aliases,
  );
  const labeled = labelFlow(collapsed.points, fiscalYearEndMonth);
  const acceptedEnds = labeled.points
    .filter((point) => point.span === 'quarter')
    .map((point) => point.end);
  const newestAccepted = acceptedEnds.sort().at(-1);
  const refusedLatest = collapsed.refusedQuarterEnds.some(
    (end) => !newestAccepted || end >= newestAccepted,
  );
  return {
    kind: 'points',
    unit: chosen,
    points: labeled.points,
    refusedLatest: refusedLatest || labeled.refusedLatest,
    refusedAnnual: collapsed.refusedAnnual || labeled.refusedAnnual,
  };
}

function usable(fact: NormalizedFactInput, asOf: string, cik: string): boolean {
  if (!DATE.test(fact.end) || !DATE.test(fact.filed) || fact.filed > asOf) {
    return false;
  }
  if (fact.start !== undefined && !DATE.test(fact.start)) return false;
  if (!ACCESSION.test(fact.accn) || !filingIndexUrl(cik, fact.accn))
    return false;
  return typeof fact.val === 'number' && Number.isSafeInteger(fact.val);
}

function chooseUnit(units: string[], kind: 'money'): string | undefined {
  const distinct = [...new Set(units)];
  if (kind === 'money') {
    const money = distinct.filter((unit) => /^[A-Z]{3}$/.test(unit));
    if (money.includes('USD')) return 'USD';
    if (money.length === 1) return money[0];
    if (money.length > 1) return 'mixed';
  }
  return undefined;
}

function collapse(
  rows: NormalizedFactInput[],
  unit: string,
  cik: string,
  aliases: readonly string[],
): { points: Point[]; refusedQuarterEnds: string[]; refusedAnnual: boolean } {
  const groups = new Map<string, NormalizedFactInput[]>();
  for (const row of rows) {
    const key = `${row.start ?? ''}|${row.end}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const points: Point[] = [];
  const refusedQuarterEnds: string[] = [];
  const refusedYearEnds: string[] = [];
  for (const group of groups.values()) {
    const byConcept = new Map<string, NormalizedFactInput[]>();
    for (const row of group) {
      byConcept.set(row.concept, [...(byConcept.get(row.concept) ?? []), row]);
    }
    const resolved: Array<{
      current: NormalizedFactInput;
      prior?: NormalizedFactInput;
    }> = [];
    let refusedFiled: string | undefined;
    for (const conceptRows of byConcept.values()) {
      const chosen = chooseComparable(conceptRows);
      if (chosen.status === 'refused') {
        const filed = conceptRows
          .map((row) => row.filed)
          .sort()
          .at(-1);
        if (filed && (!refusedFiled || filed > refusedFiled))
          refusedFiled = filed;
        continue;
      }
      resolved.push({ current: chosen.current, prior: chosen.prior });
    }
    const sample = group[0];
    const span = sample ? classify(sample.start, sample.end) : 'irregular';
    const end = sample?.end ?? '';
    const refuse = () => {
      if (span === 'year') refusedYearEnds.push(end);
      if (span === 'quarter') refusedQuarterEnds.push(end);
    };
    if (!resolved.length) {
      refuse();
      continue;
    }
    resolved.sort(
      (a, b) =>
        b.current.filed.localeCompare(a.current.filed) ||
        b.current.accn.localeCompare(a.current.accn) ||
        conceptRank(a.current.concept, aliases) -
          conceptRank(b.current.concept, aliases),
    );
    const winner = resolved[0];
    if (!winner || (refusedFiled && refusedFiled > winner.current.filed)) {
      refuse();
      continue;
    }
    const current = winner.current;
    points.push({
      concept: current.concept,
      unit,
      start: current.start,
      end: current.end,
      val: current.val,
      accn: current.accn,
      form: cleanForm(current.form),
      filed: current.filed,
      sourceUrl: filingIndexUrl(cik, current.accn) ?? '',
      span,
      fiscalYear: 0,
      fiscalQuarter: 1,
      restated: Boolean(winner.prior),
      priorValue: winner.prior?.val,
      priorAccession: winner.prior?.accn,
      priorFiled: winner.prior?.filed,
    });
  }
  const newestYear = points
    .filter((point) => point.span === 'year')
    .map((point) => point.end)
    .sort()
    .at(-1);
  return {
    points,
    refusedQuarterEnds,
    refusedAnnual: refusedYearEnds.some(
      (end) => !newestYear || end >= newestYear,
    ),
  };
}

/**
 * companyfacts and companyconcept only include non-custom taxonomy facts that
 * apply to the entire filing entity. Same concept, unit, and period is one
 * context. The documented fact fields are start, end, val, accn, fy, fp,
 * form, filed, and optional frame. fy, fp, and frame describe the filing or
 * a calendar frame, not a segment, so they are not a second context.
 * Identical values are repeated comparatives, including the same fact stored
 * once with a frame and once without. The latest filing of an identical
 * value wins. A later amending form (10-Q/A or 10-K/A) with one replacement
 * value is a restatement. Any other disagreement inside one concept is
 * withheld. A different concept for the same period is resolved on its own.
 * A later filing wins. The same filing (same date and accession) with two
 * values uses GAAP_ALIASES order, earlier alias first.
 */
function chooseComparable(group: NormalizedFactInput[]):
  | {
      status: 'chosen';
      current: NormalizedFactInput;
      prior?: NormalizedFactInput;
    }
  | { status: 'refused'; end: string } {
  const periodic = group.filter((row) =>
    PERIODIC_FORMS.has(cleanForm(row.form)),
  );
  const end = group[0]?.end ?? '';
  if (!periodic.length) return { status: 'refused', end };
  const sorted = [...periodic].sort(
    (a, b) => a.filed.localeCompare(b.filed) || a.accn.localeCompare(b.accn),
  );
  let current = sorted[0];
  if (!current) return { status: 'refused', end };
  let prior: NormalizedFactInput | undefined;
  let restated = false;
  for (const row of sorted.slice(1)) {
    if (row.val === current.val) {
      current = row;
      continue;
    }
    const form = cleanForm(row.form);
    if (form !== '10-Q/A' && form !== '10-K/A')
      return { status: 'refused', end };
    prior = current;
    current = row;
    restated = true;
  }
  return { status: 'chosen', current, prior: restated ? prior : undefined };
}

function labelFlow(
  points: Point[],
  fiscalYearEndMonth: number,
): { points: Point[]; refusedLatest: boolean; refusedAnnual: boolean } {
  const years = new Map<number, Point>();
  const blockedYears = new Set<number>();
  const unlabeledYearEnds: string[] = [];
  for (const point of points) {
    if (point.span !== 'year' || !point.start) continue;
    const fiscalYear = fiscalYearForAnnualEnd(point.end, fiscalYearEndMonth);
    if (fiscalYear === undefined || blockedYears.has(fiscalYear)) {
      unlabeledYearEnds.push(point.end);
      continue;
    }
    const existing = years.get(fiscalYear);
    if (existing) {
      years.delete(fiscalYear);
      blockedYears.add(fiscalYear);
      unlabeledYearEnds.push(point.end, existing.end);
      continue;
    }
    years.set(fiscalYear, { ...point, fiscalYear, fiscalQuarter: 4 });
  }
  const newestYearEnd = [...years.values()]
    .map((point) => point.end)
    .sort()
    .at(-1);
  const refusedAnnual = unlabeledYearEnds.some(
    (end) => !newestYearEnd || end >= newestYearEnd,
  );
  const quarters = points.filter(
    (point) => point.span === 'quarter' && point.start,
  );
  const placed = new Map<string, Point>();
  const used = new Set<string>();
  const anchors: Array<{ fiscalYear: number; start: string }> = [];
  for (const [fiscalYear, year] of years) {
    if (year.start) anchors.push({ fiscalYear, start: year.start });
    const nextStart = addDays(year.end, 1);
    if (nextStart && !years.has(fiscalYear + 1)) {
      anchors.push({ fiscalYear: fiscalYear + 1, start: nextStart });
    }
  }
  for (const nominal of nominalYearStarts(fiscalYearEndMonth, quarters)) {
    if (!anchors.some((anchor) => anchor.fiscalYear === nominal.fiscalYear)) {
      anchors.push(nominal);
    }
  }
  for (const anchor of anchors) {
    let start: string | undefined = anchor.start;
    for (let quarter = 1; quarter <= 4 && start; quarter += 1) {
      const matches = quarters.filter(
        (point) => point.start === start && !used.has(periodKey(point)),
      );
      if (matches.length !== 1) {
        if (matches.length > 1) {
          for (const match of matches) used.add(periodKey(match));
        }
        break;
      }
      const point = matches[0];
      if (!point) break;
      placed.set(`${anchor.fiscalYear}:${quarter}`, {
        ...point,
        fiscalYear: anchor.fiscalYear,
        fiscalQuarter: quarter as Quarter,
      });
      used.add(periodKey(point));
      start = addDays(point.end, 1);
    }
  }
  const labeledQuarters = [...placed.values()];
  const newest = labeledQuarters
    .map((point) => point.end)
    .sort()
    .at(-1);
  const unlabeled = quarters.filter((point) => !used.has(periodKey(point)));
  const collided = quarters.filter((point) => {
    const key = periodKey(point);
    return (
      used.has(key) && !labeledQuarters.some((item) => periodKey(item) === key)
    );
  });
  const refusedLatest = [...unlabeled, ...collided].some(
    (point) => !newest || point.end >= newest,
  );
  const instants = points.filter((point) => point.span === 'instant');
  return {
    points: [...years.values(), ...labeledQuarters, ...instants],
    refusedLatest,
    refusedAnnual,
  };
}

function nominalYearStarts(
  fiscalYearEndMonth: number,
  quarters: Point[],
): Array<{ fiscalYear: number; start: string }> {
  const anchors: Array<{ fiscalYear: number; start: string }> = [];
  const years = new Set(
    quarters.flatMap((point) => {
      const year = Number(point.start?.slice(0, 4));
      return Number.isInteger(year) ? [year - 1, year, year + 1] : [];
    }),
  );
  for (const year of years) {
    const nominal = addDays(lastDayOfMonth(year, fiscalYearEndMonth), 1);
    if (!nominal) continue;
    const near = quarters.filter((point) => {
      const start = point.start ? dayNumber(point.start) : undefined;
      const nominalDay = dayNumber(nominal);
      return (
        start !== undefined &&
        nominalDay !== undefined &&
        Math.abs(start - nominalDay) <= FISCAL_SPILL_DAYS
      );
    });
    const starts = [...new Set(near.map((point) => point.start))];
    const only = starts.length === 1 ? starts[0] : undefined;
    if (only) anchors.push({ fiscalYear: year + 1, start: only });
  }
  return anchors;
}

function periodKey(point: Point): string {
  return `${point.start ?? ''}|${point.end}`;
}

function classify(start: string | undefined, end: string): Span {
  if (!start) return 'instant';
  const from = dayNumber(start);
  const to = dayNumber(end);
  if (from === undefined || to === undefined || to < from) return 'irregular';
  const days = to - from;
  if (days >= 80 && days <= 100) return 'quarter';
  if (days >= 350 && days <= 380) return 'year';
  if (days >= 101 && days <= 349) return 'ytd';
  return 'irregular';
}

function indexFlow(points: Point[]): {
  quarters: Map<string, Point | 'conflict'>;
  years: Map<number, Point | 'conflict'>;
} {
  const quarters = new Map<string, Point | 'conflict'>();
  const years = new Map<number, Point | 'conflict'>();
  for (const point of points) {
    if (point.span === 'quarter') {
      const key = quarterKey(point.fiscalYear, point.fiscalQuarter);
      const existing = quarters.get(key);
      quarters.set(
        key,
        !existing
          ? point
          : existing === 'conflict' ||
              existing.start !== point.start ||
              existing.end !== point.end
            ? 'conflict'
            : existing,
      );
    }
    if (point.span === 'year') {
      const existing = years.get(point.fiscalYear);
      years.set(
        point.fiscalYear,
        !existing
          ? point
          : existing === 'conflict' ||
              existing.start !== point.start ||
              existing.end !== point.end
            ? 'conflict'
            : existing,
      );
    }
  }
  return { quarters, years };
}

function deriveQ4(
  flow: {
    quarters: Map<string, Point | 'conflict'>;
    years: Map<number, Point | 'conflict'>;
  },
  unit: string | undefined,
): Map<string, Point> {
  const derived = new Map<string, Point>();
  if (!unit) return derived;
  for (const [fiscalYear, year] of flow.years) {
    if (year === 'conflict') continue;
    if (flow.quarters.get(quarterKey(fiscalYear, 4))) continue;
    const q1 = flow.quarters.get(quarterKey(fiscalYear, 1));
    const q2 = flow.quarters.get(quarterKey(fiscalYear, 2));
    const q3 = flow.quarters.get(quarterKey(fiscalYear, 3));
    if (!isPoint(q1) || !isPoint(q2) || !isPoint(q3)) continue;
    if (!q1.start || !year.start || q1.start !== year.start) continue;
    if (addDays(q1.end, 1) !== q2.start || addDays(q2.end, 1) !== q3.start) {
      continue;
    }
    if (
      q1.concept !== year.concept ||
      q2.concept !== year.concept ||
      q3.concept !== year.concept
    ) {
      continue;
    }
    const start = addDays(q3.end, 1);
    if (!start || start > year.end || q3.end >= year.end) continue;
    const value = year.val - q1.val - q2.val - q3.val;
    if (!Number.isSafeInteger(value)) continue;
    const inputs = [year, q1, q2, q3];
    derived.set(quarterKey(fiscalYear, 4), {
      concept: year.concept,
      unit,
      start,
      end: year.end,
      val: value,
      accn: year.accn,
      form: year.form,
      filed:
        inputs
          .map((point) => point.filed)
          .sort()
          .at(-1) ?? year.filed,
      sourceUrl: year.sourceUrl,
      span: 'quarter',
      fiscalYear,
      fiscalQuarter: 4,
      restated: inputs.some((point) => point.restated),
      derived: true,
      formula: 'full_year - q1 - q2 - q3',
      inputs,
    });
  }
  return derived;
}

function latestQuarter(
  flow: { quarters: Map<string, Point | 'conflict'> },
  derived: Map<string, Point>,
): Point | undefined {
  const points = [
    ...[...flow.quarters.values()].filter(isPoint),
    ...derived.values(),
  ];
  return points.sort(
    (a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed),
  )[0];
}

function latestYear(years: Map<number, Point | 'conflict'>): Point | undefined {
  return [...years.values()]
    .filter(isPoint)
    .sort((a, b) => b.end.localeCompare(a.end))[0];
}

function quarterPoint(
  quarters: Map<string, Point | 'conflict'>,
  derived: Map<string, Point>,
  fiscalYear: number,
  fiscalQuarter: Quarter,
): Point | undefined {
  const explicit = quarters.get(quarterKey(fiscalYear, fiscalQuarter));
  if (explicit === 'conflict') return undefined;
  return explicit ?? derived.get(quarterKey(fiscalYear, fiscalQuarter));
}

function yearPoint(
  years: Map<number, Point | 'conflict'>,
  fiscalYear: number,
): Point | undefined {
  const point = years.get(fiscalYear);
  return isPoint(point) ? point : undefined;
}

function trailingWindow(
  quarters: Map<string, Point | 'conflict'>,
  derived: Map<string, Point>,
  latest: Point | undefined,
): { metric: CompanyMetric; parts: Point[] } {
  if (!latest) {
    return { metric: unavailable('insufficient_periods'), parts: [] };
  }
  const parts = [latest];
  let fiscalYear = latest.fiscalYear;
  let fiscalQuarter = latest.fiscalQuarter;
  for (let step = 0; step < 3; step++) {
    if (fiscalQuarter === 1) {
      fiscalYear -= 1;
      fiscalQuarter = 4;
    } else {
      fiscalQuarter = (fiscalQuarter - 1) as Quarter;
    }
    const point = quarterPoint(quarters, derived, fiscalYear, fiscalQuarter);
    if (!point) {
      return { metric: unavailable('insufficient_periods'), parts: [] };
    }
    parts.push(point);
  }
  if (parts.some((point) => point.concept !== latest.concept)) {
    return { metric: unavailable('not_comparable'), parts: [] };
  }
  const value = parts.reduce((sum, point) => sum + point.val, 0);
  if (!Number.isSafeInteger(value)) {
    return { metric: unavailable('not_comparable'), parts: [] };
  }
  return {
    parts,
    metric: {
      available: true,
      value,
      unit: latest.unit,
      display: formatMoney(value, latest.unit),
      derived: true,
      formula: 'q + q-1 + q-2 + q-3',
      inputCitations: parts.map(citation),
    },
  };
}

function spanOf(parts: Point[]): { start?: string; end?: string } {
  const starts = parts
    .map((point) => point.start)
    .filter((start): start is string => Boolean(start))
    .sort();
  const ends = parts.map((point) => point.end).sort();
  return { start: starts[0], end: ends.at(-1) };
}

function summedGrowth(
  current: CompanyMetric,
  prior: CompanyMetric,
): CompanyMetric {
  if (
    !current.available ||
    !prior.available ||
    current.value === undefined ||
    prior.value === undefined
  ) {
    return unavailable(
      prior.reason ?? current.reason ?? 'insufficient_periods',
    );
  }
  if (current.unit !== prior.unit) return unavailable('mixed_currency');
  if (prior.value === 0) return unavailable('zero_denominator');
  const ratio = round6((current.value - prior.value) / prior.value);
  return {
    available: true,
    value: ratio,
    display: formatPercent(ratio),
    derived: true,
    formula: '(current - prior) / prior',
    inputCitations: [
      ...(prior.inputCitations ?? []),
      ...(current.inputCitations ?? []),
    ],
  };
}

function marginFromSums(
  income: { metric: CompanyMetric; parts: Point[] },
  revenue: { metric: CompanyMetric; parts: Point[] },
): CompanyMetric {
  if (!revenue.metric.available || revenue.metric.value === undefined) {
    return unavailable(revenue.metric.reason ?? 'missing');
  }
  if (!income.metric.available || income.metric.value === undefined) {
    return unavailable(income.metric.reason ?? 'missing');
  }
  if (
    income.parts.length !== revenue.parts.length ||
    income.parts.length === 0
  ) {
    return unavailable('insufficient_periods');
  }
  const revenueConcept = revenue.parts[0]?.concept;
  const incomeConcept = income.parts[0]?.concept;
  if (
    !revenueConcept ||
    !incomeConcept ||
    revenue.parts.some((part) => part.concept !== revenueConcept) ||
    income.parts.some((part) => part.concept !== incomeConcept)
  ) {
    return unavailable('not_comparable');
  }
  for (let index = 0; index < income.parts.length; index += 1) {
    const left = income.parts[index];
    const right = revenue.parts[index];
    if (
      !left ||
      !right ||
      left.start !== right.start ||
      left.end !== right.end ||
      left.unit !== right.unit ||
      right.concept !== revenueConcept
    ) {
      return unavailable('not_comparable');
    }
  }
  if (revenue.metric.value === 0) return unavailable('zero_denominator');
  const ratio = round6(income.metric.value / revenue.metric.value);
  return {
    available: true,
    value: ratio,
    display: formatPercent(ratio),
    derived: true,
    formula: 'operating_income / revenue',
    inputCitations: [
      ...(income.metric.inputCitations ?? []),
      ...(revenue.metric.inputCitations ?? []),
    ],
  };
}

function growth(current?: Point, prior?: Point): CompanyMetric {
  if (!current || !prior) return unavailable('insufficient_periods');
  if (current.unit !== prior.unit) return unavailable('mixed_currency');
  if (prior.val === 0) return unavailable('zero_denominator');
  const ratio = round6((current.val - prior.val) / prior.val);
  return {
    available: true,
    value: ratio,
    display: formatPercent(ratio),
    derived: true,
    formula: '(current - prior) / prior',
    inputCitations: [citation(prior), citation(current)],
  };
}

function margin(
  income: Point | undefined,
  revenue: Point | undefined,
): CompanyMetric {
  if (!income || !revenue) return unavailable('missing');
  if (income.unit !== revenue.unit) return unavailable('mixed_currency');
  if (income.start !== revenue.start || income.end !== revenue.end) {
    return unavailable('not_comparable');
  }
  if (revenue.val === 0) return unavailable('zero_denominator');
  const ratio = round6(income.val / revenue.val);
  return {
    available: true,
    value: ratio,
    display: formatPercent(ratio),
    derived: true,
    formula: 'operating_income / revenue',
    inputCitations: [citation(income), citation(revenue)],
  };
}

function metricFrom(series: Series, point: Point | undefined): CompanyMetric {
  if (series.kind === 'mixed') return unavailable('mixed_currency');
  if (!point) return unavailable('missing');
  return {
    available: true,
    value: point.val,
    unit: point.unit,
    display: formatMoney(point.val, point.unit),
    derived: point.derived || undefined,
    formula: point.formula,
    restated: point.restated || undefined,
    priorValue: point.priorValue,
    priorAccession: point.priorAccession,
    priorFiled: point.priorFiled,
    citation: point.derived ? undefined : citation(point),
    inputCitations: point.inputs?.map(citation),
  };
}

function instantMetric(series: Series): CompanyMetric {
  if (series.kind === 'mixed') return unavailable('mixed_currency');
  if (series.kind === 'empty') return unavailable('missing');
  const point = series.points
    .filter((item) => item.span === 'instant')
    .sort(
      (a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed),
    )[0];
  return metricFrom(series, point);
}

function citation(point: Point): CompanyCitation {
  return {
    concept: point.concept,
    form: point.form,
    accession: point.accn,
    filed: point.filed,
    periodStart: point.start,
    periodEnd: point.end,
    sourceUrl: point.sourceUrl,
    unit: point.unit,
    value: point.val,
  };
}

function unavailable(reason: CompanyMetricReason): CompanyMetric {
  return { available: false, reason };
}

function pointsOf(series: Series): Point[] {
  return series.kind === 'points' ? series.points : [];
}

function unitOf(series: Series): string | undefined {
  return series.kind === 'points' ? series.unit : undefined;
}

function isPoint(value: Point | 'conflict' | undefined): value is Point {
  return Boolean(value) && value !== 'conflict';
}

function quarterKey(fiscalYear: number, fiscalQuarter: Quarter): string {
  return `${fiscalYear}:${fiscalQuarter}`;
}

function cleanForm(form: string | undefined): string {
  return form && FORMS.has(form) ? form : 'filing';
}

function cadence(filings: CompanyFiling[], asOf: string): 'current' | 'stale' {
  const newest = filings
    .filter((filing) =>
      ['10-K', '10-Q', '10-K/A', '10-Q/A'].includes(filing.form),
    )
    .map((filing) => filing.filed)
    .sort()
    .at(-1);
  const end = dayNumber(asOf);
  const filed = newest ? dayNumber(newest) : undefined;
  if (end === undefined || filed === undefined) return 'stale';
  return end - filed <= 120 ? 'current' : 'stale';
}

function collectLinks(
  metrics: Array<CompanyMetric | undefined>,
  filings: CompanyFiling[],
): CompanyResearchData['links'] {
  const links: CompanyResearchData['links'] = [];
  const add = (label: string, url: string) => {
    if (!url.startsWith('https://www.sec.gov/Archives/edgar/data/')) return;
    if (links.some((link) => link.url === url)) return;
    links.push({ label, url });
  };
  for (const metric of metrics) {
    for (const item of [metric?.citation, ...(metric?.inputCitations ?? [])]) {
      if (!item) continue;
      add(`${item.form} filed ${item.filed}`, item.sourceUrl);
    }
  }
  for (const filing of filings) {
    add(`${filing.form} filed ${filing.filed}`, filing.sourceUrl);
  }
  return links;
}

function briefingLines(input: {
  name: string;
  ticker: string;
  cik: string;
  quarter?: CompanyPeriod;
  annual?: CompanyPeriod;
  ttm: {
    revenue: CompanyMetric;
    netIncome: CompanyMetric;
    operatingMargin?: CompanyMetric;
    revenueGrowth?: CompanyMetric;
    start?: string;
    end?: string;
  };
  quarterlyRevenue?: CompanyMetric;
  quarterlyGrowth: CompanyMetric;
  annualGrowth: CompanyMetric;
  margin?: CompanyMetric;
  annualUnavailable?: CompanyMetricReason;
  cadence: 'current' | 'stale';
  filingsNote?: string;
}): string[] {
  const lines = [
    `${input.name} (${input.ticker}) company figures use SEC CIK ${input.cik}.`,
  ];
  const quarterRevenue = input.quarterlyRevenue ?? input.quarter?.revenue;
  const quarterLabel = input.quarter ? periodPhrase(input.quarter) : undefined;
  if (quarterRevenue?.available && quarterRevenue.display && quarterLabel) {
    const sources = sourceLinks(quarterRevenue);
    lines.push(
      input.quarter?.derived
        ? `Derived ${quarterLabel} revenue is ${quarterRevenue.display}, from full-year minus Q1, Q2 and Q3${sources}.`
        : `Latest quarter ${quarterLabel} revenue is ${quarterRevenue.display}${sources}.`,
    );
    if (
      quarterRevenue.restated &&
      quarterRevenue.priorValue !== undefined &&
      quarterRevenue.priorAccession
    ) {
      const priorUrl = filingIndexUrl(input.cik, quarterRevenue.priorAccession);
      const prior = priorUrl
        ? `[accession ${quarterRevenue.priorAccession} filed ${quarterRevenue.priorFiled}](${priorUrl})`
        : `accession ${quarterRevenue.priorAccession} filed ${quarterRevenue.priorFiled}`;
      lines.push(
        `That revenue was revised from ${formatMoney(quarterRevenue.priorValue, quarterRevenue.unit ?? 'USD')} in ${prior}.`,
      );
    }
  } else {
    lines.push(
      `Quarterly revenue is unavailable (${quarterRevenue?.reason ?? 'insufficient_periods'}).`,
    );
  }
  lines.push(
    moneySentence(
      'Latest quarter net income',
      input.quarter?.netIncome,
      quarterLabel,
    ),
  );
  lines.push(
    input.margin?.available && input.margin.display
      ? `Operating margin for ${quarterLabel ?? 'the latest comparable period'} is ${input.margin.display}${sourceLinks(input.margin)}.`
      : `Operating margin is unavailable (${input.margin?.reason ?? 'missing'}).`,
  );
  const ttmLabel =
    input.ttm.start && input.ttm.end
      ? `(${input.ttm.start} to ${input.ttm.end})`
      : undefined;
  lines.push(
    moneySentence('Trailing twelve-month revenue', input.ttm.revenue, ttmLabel),
  );
  lines.push(
    moneySentence(
      'Trailing twelve-month net income',
      input.ttm.netIncome,
      ttmLabel,
    ),
  );
  lines.push(
    input.ttm.operatingMargin?.available && input.ttm.operatingMargin.display
      ? `Trailing twelve-month operating margin${ttmLabel ? ` ${ttmLabel}` : ''} is ${input.ttm.operatingMargin.display}${sourceLinks(input.ttm.operatingMargin)}.`
      : `Trailing twelve-month operating margin is unavailable (${input.ttm.operatingMargin?.reason ?? 'missing'}).`,
  );
  const annualLabel = input.annual ? periodPhrase(input.annual) : undefined;
  if (input.annual?.revenue.available && input.annual.revenue.display) {
    lines.push(
      `Full-year ${annualLabel} revenue is ${input.annual.revenue.display}${sourceLinks(input.annual.revenue)}.`,
    );
  } else {
    lines.push(
      `Full-year revenue is unavailable (${input.annual?.revenue.reason ?? input.annualUnavailable ?? 'missing'}).`,
    );
  }
  lines.push(
    moneySentence('Full-year net income', input.annual?.netIncome, annualLabel),
  );
  lines.push(
    input.annual?.operatingMargin?.available &&
      input.annual.operatingMargin.display
      ? `Full-year operating margin for ${annualLabel} is ${input.annual.operatingMargin.display}${sourceLinks(input.annual.operatingMargin)}.`
      : `Full-year operating margin is unavailable (${input.annual?.operatingMargin?.reason ?? 'missing'}).`,
  );
  lines.push(
    input.annualGrowth.available && input.annualGrowth.display && input.annual
      ? `Full-year revenue changed ${input.annualGrowth.display} from FY${input.annual.fiscalYear - 1}${sourceLinks(input.annualGrowth)}.`
      : `Full-year revenue growth is unavailable (${input.annualGrowth.reason ?? 'insufficient_periods'}).`,
  );
  lines.push(
    input.quarterlyGrowth.available && input.quarterlyGrowth.display
      ? `Quarterly revenue changed ${input.quarterlyGrowth.display} from the same quarter a year earlier${sourceLinks(input.quarterlyGrowth)}.`
      : `Quarterly revenue growth is unavailable (${input.quarterlyGrowth.reason ?? 'insufficient_periods'}).`,
  );
  lines.push(
    input.ttm.revenueGrowth?.available && input.ttm.revenueGrowth.display
      ? `Trailing twelve-month revenue changed ${input.ttm.revenueGrowth.display} from the prior trailing twelve months${sourceLinks(input.ttm.revenueGrowth)}.`
      : `Trailing twelve-month revenue growth is unavailable (${input.ttm.revenueGrowth?.reason ?? 'insufficient_periods'}).`,
  );
  if (input.cadence === 'stale') {
    lines.push('The newest 10-K or 10-Q on file is older than 120 days.');
  }
  if (input.filingsNote) lines.push(input.filingsNote);
  lines.push('Filing facts, not the Oren Score, not a recommendation.');
  return lines;
}

function periodPhrase(period: {
  fiscalYear: number;
  fiscalQuarter?: number;
  start: string;
  end: string;
}): string {
  const label = period.fiscalQuarter
    ? `FY${period.fiscalYear} Q${period.fiscalQuarter}`
    : `FY${period.fiscalYear}`;
  return `${label} (${period.start} to ${period.end})`;
}

function sourceLinks(metric: CompanyMetric | undefined): string {
  const links = new Map<string, CompanyCitation>();
  for (const item of [metric?.citation, ...(metric?.inputCitations ?? [])]) {
    if (
      !item?.sourceUrl?.startsWith('https://www.sec.gov/Archives/edgar/data/')
    ) {
      continue;
    }
    const existing = links.get(item.sourceUrl);
    if (!existing || item.filed > existing.filed)
      links.set(item.sourceUrl, item);
  }
  const sorted = [...links.values()].sort(
    (a, b) =>
      b.filed.localeCompare(a.filed) || b.accession.localeCompare(a.accession),
  );
  const newest = sorted[0];
  if (!newest) return '';
  return `, [${newest.form} filed ${newest.filed}](${newest.sourceUrl})`;
}

function conceptRank(concept: string, aliases: readonly string[]): number {
  const index = aliases.indexOf(concept);
  return index === -1 ? aliases.length : index;
}

function moneySentence(
  label: string,
  metric: CompanyMetric | undefined,
  period?: string,
): string {
  if (metric?.available && metric.display) {
    return `${label}${period ? ` ${period}` : ''} is ${metric.display}${sourceLinks(metric)}.`;
  }
  return `${label} is unavailable (${metric?.reason ?? 'missing'}).`;
}

function safeLabel(name: string): string {
  return /^[A-Za-z0-9 .,&'-]{1,80}$/.test(name) ? name : 'This company';
}

function citedFiled(metric: CompanyMetric | undefined): string[] {
  if (!metric) return [];
  return [metric.citation, ...(metric.inputCitations ?? [])]
    .map((item) => item?.filed)
    .filter((filed): filed is string => Boolean(filed));
}

function latestDate(values: Array<string | undefined>): string | undefined {
  return values
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
}

export function formatMoney(value: number, unit: string): string {
  const negative = value < 0;
  const digits = Math.abs(value).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const prefix = /^[A-Z]{3}$/.test(unit) && unit === 'USD' ? '$' : `${unit} `;
  return `${negative ? '-' : ''}${prefix}${grouped}`;
}

export function formatPercent(ratio: number): string {
  const pct = Math.round(ratio * 10_000) / 100;
  const negative = pct < 0;
  const abs = Math.abs(pct);
  const text = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  return `${negative ? '-' : ''}${text}%`;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function lastDayOfMonth(year: number, month: number): string {
  const date = new Date(Date.UTC(year, month, 0));
  return date.toISOString().slice(0, 10);
}

function dayNumber(iso: string): number | undefined {
  if (!DATE.test(iso)) return undefined;
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return undefined;
  }
  return utc / 86_400_000;
}

function addDays(iso: string, days: number): string | undefined {
  const day = dayNumber(iso);
  if (day === undefined) return undefined;
  return new Date((day + days) * 86_400_000).toISOString().slice(0, 10);
}
