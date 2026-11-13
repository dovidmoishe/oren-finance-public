import { pathToFileURL } from 'node:url';

export function validateMcpSignerConfig(env) {
  if (env.NEXT_PUBLIC_DEPLOYMENT_ENV !== 'production') return;
  for (const key of ['NEXT_PUBLIC_MCP_SIGNER_QUORUM_ID', 'NEXT_PUBLIC_MCP_SIGNER_POLICY_ID']) {
    if (!/^[a-zA-Z0-9_-]{1,256}$/.test(env[key] ?? ''))
      throw new Error(`Production chat trading requires ${key}. Set the verified MCP_SIGNER_QUORUM_ID and MCP_SIGNER_POLICY_ID repository variables before building.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateMcpSignerConfig(process.env);
}
