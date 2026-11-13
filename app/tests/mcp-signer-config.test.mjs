import assert from 'node:assert/strict';
import test from 'node:test';
import { validateMcpSignerConfig } from '../scripts/validate-mcp-signer-config.mjs';
test('production web images require both reviewed public signer pins', () => {
  const env = { NEXT_PUBLIC_DEPLOYMENT_ENV: 'production', NEXT_PUBLIC_MCP_SIGNER_QUORUM_ID: 'quorum', NEXT_PUBLIC_MCP_SIGNER_POLICY_ID: 'policy' };
  validateMcpSignerConfig(env);
  for (const key of ['NEXT_PUBLIC_MCP_SIGNER_QUORUM_ID', 'NEXT_PUBLIC_MCP_SIGNER_POLICY_ID'])
    assert.throws(() => validateMcpSignerConfig({ ...env, [key]: '' }), /Production chat trading requires/);
});
test('isolated previews do not enroll production signers', () => {
  validateMcpSignerConfig({ NEXT_PUBLIC_DEPLOYMENT_ENV: 'preview' });
});
