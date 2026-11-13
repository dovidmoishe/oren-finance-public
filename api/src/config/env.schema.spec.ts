import { migrateJupiterUrl, validateEnv } from './env.schema';

const required = {
  POSTGRES_URL: 'postgres://test',
  TOKENS_API_KEY: 'tokens-test',
  ALCHEMY_API_KEY: 'alchemy-test',
};

describe('validateEnv — Jupiter', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('defaults to api.jup.ag with the keyless 0.5 rps budget', () => {
    const env = validateEnv(required);
    expect(env.JUPITER_API_URL).toBe('https://api.jup.ag/swap/v1');
    expect(env.JUPITER_TRIGGER_API_URL).toBeUndefined();
    expect(env.JUPITER_API_KEY).toBeUndefined();
    expect(env.JUPITER_MAX_RPS).toBe(0.5);
  });

  it('raises the Jupiter default budget to 1 rps when a key is set', () => {
    expect(
      validateEnv({ ...required, JUPITER_API_KEY: 'k' }).JUPITER_MAX_RPS,
    ).toBe(1);
    expect(
      validateEnv({ ...required, JUPITER_API_KEY: 'k', JUPITER_MAX_RPS: '10' })
        .JUPITER_MAX_RPS,
    ).toBe(10);
  });

  it('rewrites a stale lite-api.jup.ag override to api.jup.ag', () => {
    const env = validateEnv({
      ...required,
      JUPITER_API_URL: 'https://lite-api.jup.ag/swap/v1/',
      JUPITER_TRIGGER_API_URL: 'https://lite-api.jup.ag/trigger/v1',
    });
    expect(env.JUPITER_API_URL).toBe('https://api.jup.ag/swap/v1');
    expect(env.JUPITER_TRIGGER_API_URL).toBe('https://api.jup.ag/trigger/v1');
    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(migrateJupiterUrl('https://jupiter.example/swap/v1')).toBe(
      'https://jupiter.example/swap/v1',
    );
  });

  it('rejects a non-positive JUPITER_MAX_RPS', () => {
    expect(() => validateEnv({ ...required, JUPITER_MAX_RPS: '0' })).toThrow(
      /JUPITER_MAX_RPS/,
    );
  });
});

describe('validateEnv — swap routing (Titan)', () => {
  it('defaults to Titan disabled and jupiter-only routing', () => {
    const env = validateEnv(required);
    expect(env.TITAN_API_KEY).toBeUndefined();
    expect(env.TITAN_API_URL).toBe('https://portal.api.titan.exchange');
    expect(env.TITAN_MAX_RPS).toBe(1);
    expect(env.TITAN_EXTRA_PROGRAM_IDS).toEqual([]);
    expect(env.TITAN_MAX_PRICE_DEVIATION_BPS).toBe(100);
    expect(env.SWAP_ROUTER_MODE).toBe('jupiter');
  });

  it('reads TITAN_MAX_PRICE_DEVIATION_BPS as integer bps in 1..10000', () => {
    expect(
      validateEnv({ ...required, TITAN_MAX_PRICE_DEVIATION_BPS: '250' })
        .TITAN_MAX_PRICE_DEVIATION_BPS,
    ).toBe(250);
    for (const bad of ['0', '10001', '1.5', 'abc']) {
      expect(() =>
        validateEnv({ ...required, TITAN_MAX_PRICE_DEVIATION_BPS: bad }),
      ).toThrow(/TITAN_MAX_PRICE_DEVIATION_BPS/);
    }
  });

  it('validates SWAP_ROUTER_MODE, rps values and program lists', () => {
    expect(
      validateEnv({ ...required, SWAP_ROUTER_MODE: 'SHADOW' }).SWAP_ROUTER_MODE,
    ).toBe('shadow');
    expect(() =>
      validateEnv({ ...required, SWAP_ROUTER_MODE: 'titan' }),
    ).toThrow(/SWAP_ROUTER_MODE/);
    expect(() => validateEnv({ ...required, TITAN_MAX_RPS: '0' })).toThrow(
      /TITAN_MAX_RPS/,
    );
    expect(
      validateEnv({ ...required, TITAN_EXTRA_PROGRAM_IDS: ' a , b ,' })
        .TITAN_EXTRA_PROGRAM_IDS,
    ).toEqual(['a', 'b']);
  });
});

describe('validateEnv — delegated MCP trading', () => {
  it('defaults to disabled with explicit empty allowlist', () => {
    const env = validateEnv(required);
    expect(env.MCP_DELEGATED_TRADES_ENABLED).toBe(false);
    expect(env.MCP_DELEGATED_TRADES_ALLOWED_USERS).toEqual([]);
  });

  it('refuses preview and incomplete production configuration', () => {
    const enabled = { ...required, MCP_DELEGATED_TRADES_ENABLED: 'true' };
    expect(() => validateEnv(enabled)).toThrow(/MCP OAuth/);
    expect(() =>
      validateEnv({ ...enabled, MCP_OAUTH_ENABLED: 'true' }),
    ).toThrow(/allowlist/);
    const configured = {
      ...enabled,
      MCP_OAUTH_ENABLED: 'true',
      MCP_DELEGATED_TRADES_ALLOWED_USERS: 'did:privy:test',
      PRIVY_MCP_SIGNER_QUORUM_ID: 'quorum-test',
      PRIVY_MCP_SIGNER_PRIVATE_KEY: 'key-test',
      PRIVY_POLICY_ADMIN_QUORUM_ID: 'quorum-admin',
      SIGNER_GATE_URL: 'http://signer-gate:3001',
      SIGNER_GATE_API_TOKEN: 'test-token-not-for-production',
    };
    expect(() => validateEnv(configured)).toThrow(
      /restricted API database role/,
    );
    expect(
      validateEnv({
        ...configured,
        POSTGRES_URL: 'postgres://oren_api_runtime:test@localhost:5432/oren',
      }).MCP_DELEGATED_TRADES_ENABLED,
    ).toBe(true);
    expect(() =>
      validateEnv({
        ...configured,
        MCP_DELEGATED_TRADES_ALLOWED_USERS: '*',
      }),
    ).toThrow(/MCP_DELEGATED_TRADES_PUBLIC=true instead of a wildcard/);
    expect(() =>
      validateEnv({
        ...configured,
        DEPLOYMENT_ENV: 'preview',
        PREVIEW_PR_NUMBER: '18',
        COMMIT_SHA: 'a'.repeat(40),
      }),
    ).toThrow(/PR preview/);
  });

  it('opens enrollment to all users only through the public flag', () => {
    const configured = {
      ...required,
      MCP_DELEGATED_TRADES_ENABLED: 'true',
      MCP_OAUTH_ENABLED: 'true',
      PRIVY_MCP_SIGNER_QUORUM_ID: 'quorum-test',
      PRIVY_MCP_SIGNER_PRIVATE_KEY: 'key-test',
      PRIVY_POLICY_ADMIN_QUORUM_ID: 'quorum-admin',
      SIGNER_GATE_URL: 'http://signer-gate:3001',
      SIGNER_GATE_API_TOKEN: 'test-token-not-for-production',
      POSTGRES_URL: 'postgres://oren_api_runtime:test@localhost:5432/oren',
    };
    expect(() => validateEnv(configured)).toThrow(/allowlist/);
    const open = validateEnv({
      ...configured,
      MCP_DELEGATED_TRADES_PUBLIC: 'true',
    });
    expect(open.MCP_DELEGATED_TRADES_PUBLIC).toBe(true);
    expect(open.MCP_DELEGATED_TRADES_ALLOWED_USERS).toEqual([]);
    expect(open.MCP_DELEGATED_MAX_PER_TRADE_USD).toBe(25);
    expect(open.MCP_DELEGATED_MAX_DAILY_USD).toBe(50);
    expect(() =>
      validateEnv({
        ...configured,
        MCP_DELEGATED_TRADES_PUBLIC: 'true',
        DEPLOYMENT_ENV: 'preview',
        PREVIEW_PR_NUMBER: '18',
        COMMIT_SHA: 'a'.repeat(40),
      }),
    ).toThrow(/PR preview/);
  });

  it('ignores the public flag while delegated trades are off', () => {
    expect(
      validateEnv({ ...required, MCP_DELEGATED_TRADES_PUBLIC: 'true' })
        .MCP_DELEGATED_TRADES_PUBLIC,
    ).toBe(false);
  });
});

describe('validateEnv — Drip', () => {
  it('keeps Drip off by default', () => {
    const env = validateEnv(required);
    expect(env.DRIP_ENABLED).toBe(false);
    expect(env.DRIP_API_KEY).toBeUndefined();
    expect(env.DRIP_API_BASE_URL).toBe('https://dripstack.com');
    expect(env.DRIP_PUBLIC_RESEARCH_ENABLED).toBe(false);
    expect(env.DRIP_REQUEST_TIMEOUT_MS).toBe(12_000);
  });

  it('parses the flags and server-only key', () => {
    const env = validateEnv({
      ...required,
      DRIP_ENABLED: 'true',
      DRIP_API_KEY: 'pk_drip_test',
      DRIP_PUBLIC_RESEARCH_ENABLED: 'true',
      DRIP_API_BASE_URL: 'https://dripstack.test/',
      DRIP_REQUEST_TIMEOUT_MS: '9000',
    });
    expect(env.DRIP_ENABLED).toBe(true);
    expect(env.DRIP_API_KEY).toBe('pk_drip_test');
    expect(env.DRIP_PUBLIC_RESEARCH_ENABLED).toBe(true);
    expect(env.DRIP_API_BASE_URL).toBe('https://dripstack.test');
    expect(env.DRIP_REQUEST_TIMEOUT_MS).toBe(9000);
  });
});

describe('validateEnv — CORS_ORIGIN', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  const production = { ...required, DEPLOYMENT_ENV: 'production' };

  it('keeps the permissive default outside production', () => {
    expect(validateEnv(required).CORS_ORIGIN).toBe('*');
    expect(warn).not.toHaveBeenCalled();
  });

  it('uses an explicit production origin list as is', () => {
    expect(
      validateEnv({
        ...production,
        CORS_ORIGIN: 'https://oren.finance,https://www.oren.finance',
        MCP_APP_ORIGIN: 'https://other.example',
      }).CORS_ORIGIN,
    ).toBe('https://oren.finance,https://www.oren.finance');
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([undefined, '*'])(
    'falls back to MCP_APP_ORIGIN in production when CORS_ORIGIN is %s',
    (cors) => {
      expect(
        validateEnv({
          ...production,
          CORS_ORIGIN: cors,
          MCP_APP_ORIGIN: 'https://oren.finance/',
          DOMAIN: 'ignored.example',
        }).CORS_ORIGIN,
      ).toBe('https://oren.finance');
      expect(warn).toHaveBeenCalledTimes(1);
    },
  );

  it('falls back to https://DOMAIN in production', () => {
    expect(
      validateEnv({ ...production, CORS_ORIGIN: '*', DOMAIN: 'oren.finance' })
        .CORS_ORIGIN,
    ).toBe('https://oren.finance');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('refuses to start in production with no origin to fall back to', () => {
    expect(() => validateEnv({ ...production, CORS_ORIGIN: '*' })).toThrow(
      /CORS_ORIGIN/,
    );
  });
});

describe('validateEnv — Senviok', () => {
  it('keeps transactional email credentials optional', () => {
    const env = validateEnv(required);
    expect(env.SENVIOK_API_KEY).toBeUndefined();
    expect(env.SENVIOK_FROM).toBeUndefined();
  });

  it('reads the server-side API key and sender', () => {
    const env = validateEnv({
      ...required,
      SENVIOK_API_KEY: 'svk_test',
      SENVIOK_FROM: 'updates@example.com',
    });
    expect(env.SENVIOK_API_KEY).toBe('svk_test');
    expect(env.SENVIOK_FROM).toBe('updates@example.com');
  });
});
