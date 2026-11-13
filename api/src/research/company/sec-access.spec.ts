import { secEdgarAccess } from './sec-access';

const production = {
  DEPLOYMENT_ENV: 'production' as const,
  SEC_CONTACT_EMAIL: 'filings@example.com',
  POSTGRES_URL: 'postgres://oren@localhost/oren',
};

describe('SEC access gate', () => {
  it('does not invent a contact and stays closed until production configures one', () => {
    expect(secEdgarAccess({ DEPLOYMENT_ENV: 'production' })).toEqual({
      enabled: false,
      reason: 'sec_not_configured',
    });
    expect(
      secEdgarAccess({
        DEPLOYMENT_ENV: 'production',
        SEC_CONTACT_EMAIL: 'not an email',
      }),
    ).toEqual({ enabled: false, reason: 'sec_not_configured' });
    expect(secEdgarAccess({ DEPLOYMENT_ENV: 'development' }).enabled).toBe(
      false,
    );
    const open = secEdgarAccess(production);
    expect(open).toEqual({
      enabled: true,
      userAgent: 'Oren Finance (filings@example.com)',
    });
    expect(JSON.stringify(open)).not.toContain('edgar-research@oren.finance');
  });

  it('does not fetch from a preview or from an extra worker', () => {
    expect(
      secEdgarAccess({
        ...production,
        DEPLOYMENT_ENV: 'preview',
        NODE_ENV: 'production',
        PREVIEW_PR_NUMBER: 4,
        COMMIT_SHA: 'a'.repeat(40),
      } as never),
    ).toEqual({ enabled: false, reason: 'sec_preview_disabled' });
    expect(secEdgarAccess({ ...production, NODE_APP_INSTANCE: '1' })).toEqual({
      enabled: false,
      reason: 'sec_worker_unavailable',
    });
    expect(secEdgarAccess({ ...production, WEB_CONCURRENCY: '2' })).toEqual({
      enabled: false,
      reason: 'sec_worker_unavailable',
    });
  });
});
