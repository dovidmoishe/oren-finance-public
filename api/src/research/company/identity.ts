import {
  DEFAULT_COVERAGE,
  type CoverageExclusion,
  type CoverageRegistry,
  type VerifiedCompany,
} from './coverage';

export interface IdentityEquity {
  id: string;
  ticker: string;
  name: string;
  category?: string;
  variants?: Array<{ mint?: string }>;
}

export type IdentityDecision =
  | {
      status: 'verified';
      company: VerifiedCompany;
      matchedMints: string[];
    }
  | {
      status: 'fund_no_statements' | 'no_coverage';
      assetId: string;
      ticker: string;
      detail: string;
    }
  | {
      status:
        | 'mint_mismatch'
        | 'identity_mismatch'
        | 'not_mapped'
        | 'ambiguous_identity';
      assetId: string;
      ticker: string;
    };

export function resolveCompanyIdentity(
  equity: IdentityEquity,
  registry: CoverageRegistry = DEFAULT_COVERAGE,
): IdentityDecision {
  const assetId = equity.id;
  const ticker = equity.ticker;
  const verifiedHits = registry.verified.filter(
    (row) => row.assetId === assetId,
  );
  const excludedHits = registry.excluded.filter(
    (row) => row.assetId === assetId,
  );
  if (verifiedHits.length + excludedHits.length > 1) {
    return { status: 'ambiguous_identity', assetId, ticker };
  }
  if (verifiedHits.length === 1) {
    const company = verifiedHits[0];
    if (equity.category === 'etf' || equity.category === 'index') {
      return { status: 'identity_mismatch', assetId, ticker };
    }
    const matched = matchRow(equity, company);
    if (matched !== 'ok') return { status: matched, assetId, ticker };
    return { status: 'verified', company, matchedMints: liveMints(equity) };
  }
  if (excludedHits.length === 1) {
    const row = excludedHits[0];
    const matched = matchRow(equity, row);
    if (matched !== 'ok') return { status: matched, assetId, ticker };
    return {
      status: row.reason,
      assetId,
      ticker,
      detail: row.detail,
    };
  }
  if (equity.category === 'etf' || equity.category === 'index') {
    return {
      status: 'fund_no_statements',
      assetId,
      ticker,
      detail: 'unverified_fund',
    };
  }
  return { status: 'not_mapped', assetId, ticker };
}

function matchRow(
  equity: IdentityEquity,
  row: VerifiedCompany | CoverageExclusion,
): 'ok' | 'mint_mismatch' | 'identity_mismatch' {
  if (equity.ticker.trim().toUpperCase() !== row.ticker) {
    return 'identity_mismatch';
  }
  if (equity.name.trim().toLowerCase() !== row.orenName.trim().toLowerCase()) {
    return 'identity_mismatch';
  }
  const mints = liveMints(equity);
  if (mints.length === 0 || mints.some((mint) => !row.mints.includes(mint))) {
    return 'mint_mismatch';
  }
  return 'ok';
}

function liveMints(equity: IdentityEquity): string[] {
  return [
    ...new Set(
      (equity.variants ?? [])
        .map((variant) => variant.mint?.trim() ?? '')
        .filter((mint) => mint.length > 0),
    ),
  ];
}
