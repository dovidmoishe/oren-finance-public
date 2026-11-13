/** Identity the agent can prove. Model arguments are never a caller. */
export interface DripCaller {
  userId?: string;
  email?: string;
  walletAddress?: string;
}

export interface DripAccessConfig {
  enabled: boolean;
  publicResearch: boolean;
}

/** Both flags and the server-verified user/wallet are required. */
export function dripToolsEnabled(
  config: DripAccessConfig,
  caller: DripCaller,
): boolean {
  return Boolean(
    config.enabled &&
    config.publicResearch &&
    caller.userId?.trim() &&
    caller.walletAddress?.trim(),
  );
}
