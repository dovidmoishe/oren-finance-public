export function policyAllowsStock(
  policy: {
    rules?: {
      action: string;
      conditions?: {
        field_source: string;
        field: string;
        operator: string;
        value: unknown;
      }[];
    }[];
  },
  mint: string,
): boolean {
  return (
    !!mint &&
    (policy.rules ?? []).some(
      (rule) =>
        rule.action === 'ALLOW' &&
        (rule.conditions ?? []).some(
          (c) =>
            c.field_source === 'solana_instruction_data' &&
            c.operator === 'in' &&
            [
              'shared_accounts_route.accounts.source_mint',
              'shared_accounts_route.accounts.destination_mint',
            ].includes(c.field) &&
            Array.isArray(c.value) &&
            c.value.includes(mint),
        ),
    )
  );
}

/** Earliest unconditional time cutoff in the fingerprint-verified policy. */
export function signingPolicyExpiresAt(
  policy: Parameters<typeof policyAllowsStock>[0],
): number | null {
  const cutoffs = (policy.rules ?? []).flatMap((rule) => {
    const [condition] = rule.conditions ?? [];
    if (
      !rule.conditions?.some(
        (c) =>
          c.field_source === 'system' && c.field === 'current_unix_timestamp',
      )
    )
      return [];
    if (
      rule.action !== 'DENY' ||
      rule.conditions?.length !== 1 ||
      condition?.field_source !== 'system' ||
      condition.field !== 'current_unix_timestamp' ||
      condition.operator !== 'gte' ||
      (typeof condition.value !== 'number' &&
        typeof condition.value !== 'string')
    )
      throw new Error('Signing policy has an unsupported time condition');
    const milliseconds = Number(condition.value) * 1000;
    if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0)
      throw new Error('Signing policy has an invalid expiry');
    return [milliseconds];
  });
  return cutoffs.length ? Math.min(...cutoffs) : null;
}

/** Read only the already fingerprint-verified policy, before reserving a trade. */
export function policyAllowsDestinationAccount(
  policy: Parameters<typeof policyAllowsStock>[0],
  mint: string,
): boolean {
  return (policy.rules ?? []).some(
    (rule) =>
      rule.action === 'ALLOW' &&
      (rule.conditions ?? []).some(
        (c) =>
          c.field_source === 'solana_program_instruction' &&
          c.field === 'programId' &&
          c.operator === 'eq' &&
          c.value === 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
      ) &&
      (rule.conditions ?? []).some(
        (c) =>
          c.field_source === 'solana_instruction_data' &&
          c.field === 'create_idempotent.accounts.mint' &&
          ((c.operator === 'eq' && c.value === mint) ||
            (c.operator === 'in' &&
              Array.isArray(c.value) &&
              c.value.includes(mint))),
      ),
  );
}
