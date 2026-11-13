import type { CompanyResearchData } from '../../../types/company-research';
import type { ResearchSource } from '../../../types/research';
import type { CoverageRegistry } from './coverage';
import { resolveCompanyIdentity, type IdentityEquity } from './identity';
import { normalizeFinancials } from './financials';
import { SecFetchError, type SecCompanySnapshot } from './sec-client';
import { normalizeCik, readGaapFacts, readSubmission } from './sec-documents';

export interface CompanyResearchSource {
  loadCompany(cik: string): Promise<SecCompanySnapshot>;
}

const NO_FIGURES = 'No company figures are shown.';

export async function assembleCompanyResearch(
  equity: IdentityEquity,
  options: {
    sec: CompanyResearchSource;
    now: Date;
    registry?: CoverageRegistry;
  },
): Promise<ResearchSource<CompanyResearchData>> {
  const decision = resolveCompanyIdentity(equity, options.registry);
  if (decision.status !== 'verified') {
    return closed(options.now, decision.status, coverageOf(decision.status), {
      detail: 'detail' in decision ? decision.detail : undefined,
      briefing: [
        refusal(
          decision.status,
          'detail' in decision ? decision.detail : undefined,
        ),
      ],
    });
  }
  let snapshot: SecCompanySnapshot;
  try {
    snapshot = await options.sec.loadCompany(decision.company.cik);
  } catch (error) {
    if (!(error instanceof SecFetchError)) throw error;
    return closed(options.now, error.reason, 'verified', {
      identity: identityOf(decision),
      briefing: [`${loadFailure(error.reason)} ${NO_FIGURES}`],
    });
  }
  const asOf = options.now.toISOString().slice(0, 10);
  const submissions = readSubmission(snapshot.submissions, asOf);
  const factsCik = isRecord(snapshot.facts)
    ? normalizeCik(snapshot.facts.cik)
    : undefined;
  if (
    !isRecord(snapshot.facts) ||
    !isRecord(snapshot.submissions) ||
    factsCik !== decision.company.cik ||
    submissions.cik !== decision.company.cik ||
    submissions.fiscalMonth !== decision.company.fiscalYearEndMonth ||
    !submissions.tickers.some(
      (ticker) => ticker.trim().toUpperCase() === decision.company.ticker,
    ) ||
    submissions.name?.trim().toLowerCase() !==
      decision.company.secName.trim().toLowerCase()
  ) {
    return closed(options.now, 'identity_mismatch', 'identity_mismatch', {
      identity: identityOf(decision),
      briefing: [`${refusal('identity_mismatch')} ${NO_FIGURES}`],
    });
  }
  const normalized = normalizeFinancials({
    name: decision.company.orenName,
    ticker: decision.company.ticker,
    cik: decision.company.cik,
    fiscalYearEndMonth: decision.company.fiscalYearEndMonth,
    asOf,
    facts: readGaapFacts(snapshot.facts),
    filings: submissions.filings,
    filingsNote: submissions.filingsNote,
  });
  const briefing = [...normalized.data.briefing];
  if (snapshot.freshness === 'stale') {
    briefing.splice(
      briefing.length - 1,
      0,
      "These figures were loaded from Oren's SEC cache after a refresh failed.",
    );
  }
  const stale =
    snapshot.freshness === 'stale' || normalized.filingCadence === 'stale';
  return {
    available: true,
    reason: stale ? 'stale' : undefined,
    publishedAt: normalized.publishedAt,
    fetchedAt: snapshot.fetchedAt,
    assembledAt: options.now.toISOString(),
    observedAt: normalized.publishedAt,
    data: {
      ...normalized.data,
      coverage: 'verified',
      identity: identityOf(decision),
      briefing,
    },
  };
}

function identityOf(
  decision: Extract<
    ReturnType<typeof resolveCompanyIdentity>,
    { status: 'verified' }
  >,
): NonNullable<CompanyResearchData['identity']> {
  return {
    assetId: decision.company.assetId,
    ticker: decision.company.ticker,
    name: decision.company.orenName,
    cik: decision.company.cik,
    secName: decision.company.secName,
    fiscalYearEndMonth: decision.company.fiscalYearEndMonth,
    mints: [...decision.matchedMints],
    issuerVariant: decision.company.issuerVariant,
  };
}

function closed(
  now: Date,
  reason: string,
  coverage: CompanyResearchData['coverage'],
  fields: {
    detail?: string;
    identity?: CompanyResearchData['identity'];
    briefing: string[];
  },
): ResearchSource<CompanyResearchData> {
  return {
    available: false,
    reason,
    assembledAt: now.toISOString(),
    data: {
      coverage,
      detail: fields.detail,
      identity: fields.identity,
      filings: [],
      links: [],
      briefing: fields.briefing,
    },
  };
}

function coverageOf(status: string): CompanyResearchData['coverage'] {
  if (status === 'fund_no_statements') return 'fund';
  if (status === 'no_coverage') return 'foreign';
  if (status === 'not_mapped') return 'unmapped';
  if (
    status === 'ambiguous' ||
    status === 'ambiguous_identity' ||
    status === 'mint_mismatch' ||
    status === 'identity_mismatch'
  ) {
    return status === 'ambiguous_identity' ? 'ambiguous' : status;
  }
  return 'unmapped';
}

function refusal(status: string, detail?: string): string {
  if (status === 'fund_no_statements') {
    return 'This instrument is a fund or ETF. Oren does not report operating-company statements for it.';
  }
  if (status === 'no_coverage' && detail === 'foreign_private_issuer') {
    return 'This issuer is a foreign private issuer. SEC operating-company facts are not covered for it in this release.';
  }
  if (status === 'mint_mismatch') {
    return 'The live token mint does not match the verified issuer record, so no company figures are shown.';
  }
  if (status === 'identity_mismatch') {
    return 'The live stock record does not match the verified issuer, so no company figures are shown.';
  }
  if (status === 'ambiguous_identity') {
    return 'More than one issuer matches this request. No company figures are shown.';
  }
  return 'Company filings are not available. Oren has not verified a CIK for this token.';
}

function loadFailure(reason: SecFetchError['reason']): string {
  if (reason === 'timeout') {
    return 'SEC company facts could not be loaded because the request timed out.';
  }
  if (reason === 'rate_limited') {
    return 'SEC company facts could not be loaded because the request rate was limited.';
  }
  if (reason === 'sec_not_configured') {
    return 'SEC company facts are not loaded until the server contact is configured.';
  }
  if (reason === 'sec_preview_disabled') {
    return 'SEC company facts are not loaded in previews.';
  }
  if (reason === 'sec_worker_unavailable') {
    return 'SEC company facts are not loaded from this server process.';
  }
  return 'SEC company facts could not be loaded.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
