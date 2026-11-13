import { COVERAGE_EXCLUSIONS, VERIFIED_COMPANIES } from './coverage';
import { resolveCompanyIdentity, type IdentityEquity } from './identity';

const APPLE_MINT = 'AAPLEDt8RpzPgXyhvFzkMBofvFSQw9gpeMCoUdPdLnB8';
const NVIDIA_MINT = 'NVDAVuiB7hwd3m5Wa1JuHNovPaPG6BH1QNztbKFxNjv';
const MICROSOFT_MINT = 'MSFThX899B1DddH5jkyMpdArWXzP85VXLYDrbGGcRJM';
const QQQ_MINT = 'HrYNm6jTQ71LoFphjVKBTdAE4uja7WsmLG8VxB8ondo';
const BABA_MINT = 'BABANGA4JE7Kkam4nTrALAwAVgsNJUuFJnnkF7S16BZp';

function equity(
  partial: Partial<IdentityEquity> & Pick<IdentityEquity, 'id'>,
): IdentityEquity {
  return {
    ticker: 'AAPL',
    name: 'Apple',
    category: 'equity',
    variants: [{ mint: APPLE_MINT }],
    ...partial,
  };
}

describe('verified coverage', () => {
  it('locks the three issuers to the SEC rows and mints observed on 2026-11-08', () => {
    expect(
      VERIFIED_COMPANIES.map((company) => [
        company.assetId,
        company.ticker,
        company.cik,
        company.fiscalYearEndMonth,
        company.mints[0],
      ]),
    ).toEqual([
      ['apple', 'AAPL', '0000320193', 9, APPLE_MINT],
      ['nvidia', 'NVDA', '0001045810', 1, NVIDIA_MINT],
      ['microsoft', 'MSFT', '0000789019', 6, MICROSOFT_MINT],
    ]);
    expect(VERIFIED_COMPANIES.map((company) => company.cik)).not.toContain(
      '0001181412',
    );
    expect(VERIFIED_COMPANIES.map((company) => company.assetId)).not.toContain(
      'spacex',
    );
    expect(COVERAGE_EXCLUSIONS).toEqual([
      expect.objectContaining({
        assetId: 'invesco-qqq',
        ticker: 'QQQ',
        mints: [QQQ_MINT],
        reason: 'fund_no_statements',
      }),
      expect.objectContaining({
        assetId: 'alibaba',
        ticker: 'BABA',
        mints: [BABA_MINT],
        reason: 'no_coverage',
        detail: 'foreign_private_issuer',
      }),
    ]);
  });

  it('accepts the live Apple record even though its issuer label is the ticker', () => {
    expect(
      resolveCompanyIdentity(
        equity({
          id: 'apple',
          variants: [{ mint: APPLE_MINT }],
        }),
      ),
    ).toMatchObject({ status: 'verified', company: { cik: '0000320193' } });
  });

  it('fails closed on a mint, name, extra mint, or ticker collision', () => {
    expect(
      resolveCompanyIdentity(
        equity({ id: 'apple', variants: [{ mint: 'not-the-verified-mint' }] }),
      ).status,
    ).toBe('mint_mismatch');
    expect(
      resolveCompanyIdentity(
        equity({
          id: 'apple',
          variants: [{ mint: APPLE_MINT }, { mint: 'extra-mint' }],
        }),
      ).status,
    ).toBe('mint_mismatch');
    expect(
      resolveCompanyIdentity(equity({ id: 'apple', name: 'Apple Hospitality' }))
        .status,
    ).toBe('identity_mismatch');
    expect(
      resolveCompanyIdentity(
        equity({ id: 'apple', ticker: 'AAPL', category: 'etf' }),
      ).status,
    ).toBe('identity_mismatch');
    expect(
      resolveCompanyIdentity(
        equity({
          id: 'spacex',
          ticker: 'SPCX',
          name: 'SpaceX',
          variants: [{ mint: 'SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb' }],
        }),
      ),
    ).toMatchObject({ status: 'not_mapped' });
  });

  it('names funds and the verified foreign issuer without borrowing another company', () => {
    expect(
      resolveCompanyIdentity(
        equity({
          id: 'invesco-qqq',
          ticker: 'QQQ',
          name: 'Invesco QQQ',
          category: 'etf',
          variants: [{ mint: QQQ_MINT }],
        }),
      ),
    ).toMatchObject({ status: 'fund_no_statements', detail: 'etf' });
    expect(
      resolveCompanyIdentity(
        equity({
          id: 'roundhill-memory-etf',
          ticker: 'DRAM',
          name: 'Roundhill Memory ETF',
          category: 'etf',
          variants: [{ mint: 'some-other-mint' }],
        }),
      ),
    ).toMatchObject({
      status: 'fund_no_statements',
      detail: 'unverified_fund',
    });
    expect(
      resolveCompanyIdentity(
        equity({
          id: 'alibaba',
          ticker: 'BABA',
          name: 'Alibaba',
          variants: [{ mint: BABA_MINT }],
        }),
      ),
    ).toMatchObject({
      status: 'no_coverage',
      detail: 'foreign_private_issuer',
    });
    expect(
      resolveCompanyIdentity(
        equity({
          id: 'not-qqq',
          ticker: 'QQQ',
          name: 'Invesco QQQ',
          variants: [{ mint: QQQ_MINT }],
        }),
      ).status,
    ).toBe('not_mapped');
  });

  it('treats two coverage rows for one asset as ambiguous', () => {
    const company = VERIFIED_COMPANIES[0];
    expect(
      resolveCompanyIdentity(equity({ id: 'apple' }), {
        verified: [company, { ...company, cik: '0000000001' }],
        excluded: [],
      }).status,
    ).toBe('ambiguous_identity');
  });
});
