import {
  policyAllowsStock,
  policyAllowsDestinationAccount,
} from './policy-stock-coverage';
it('uses the pinned allowlist rather than accepting a stock only because it is catalogued', () => {
  const c = {
    field_source: 'solana_instruction_data',
    field: 'shared_accounts_route.accounts.source_mint',
    operator: 'in',
    value: ['supported'],
  };
  expect(
    policyAllowsStock(
      { rules: [{ action: 'ALLOW', conditions: [c] }] },
      'supported',
    ),
  ).toBe(true);
  expect(
    policyAllowsStock(
      { rules: [{ action: 'ALLOW', conditions: [c] }] },
      'other',
    ),
  ).toBe(false);
  expect(
    policyAllowsStock(
      { rules: [{ action: 'DENY', conditions: [c] }] },
      'supported',
    ),
  ).toBe(false);
});

it('keeps account creation outside old or unrelated policies before any reservation', () => {
  const program = {
    field_source: 'solana_program_instruction',
    field: 'programId',
    operator: 'eq',
    value: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  };
  const mint = {
    field_source: 'solana_instruction_data',
    field: 'create_idempotent.accounts.mint',
    operator: 'in',
    value: ['stock'],
  };
  const policy = { rules: [{ action: 'ALLOW', conditions: [program, mint] }] };
  expect(policyAllowsDestinationAccount(policy, 'stock')).toBe(true);
  expect(policyAllowsDestinationAccount(policy, 'other')).toBe(false);
  expect(
    policyAllowsDestinationAccount(
      { rules: [{ action: 'ALLOW', conditions: [mint] }] },
      'stock',
    ),
  ).toBe(false);
  expect(
    policyAllowsDestinationAccount(
      { rules: [{ action: 'DENY', conditions: [program, mint] }] },
      'stock',
    ),
  ).toBe(false);
  expect(
    policyAllowsDestinationAccount(
      {
        rules: [
          {
            action: 'ALLOW',
            conditions: [program, { ...mint, operator: 'eq', value: 'usdc' }],
          },
        ],
      },
      'usdc',
    ),
  ).toBe(true);
});
