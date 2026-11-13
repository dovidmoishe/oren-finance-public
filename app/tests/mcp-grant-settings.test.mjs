import assert from 'node:assert/strict';
import test from 'node:test';
import { grantDurationOptions, parseGrantSettings } from '../services/mcp-grant-settings.ts';
import { validateMcpSignerConfig } from '../scripts/validate-mcp-signer-config.mjs';

const draft = { perTradeUsd: '25', dailyUsd: '50', slippagePercent: '0.5', durationHours: '24' };
test('displayed percentage becomes exact basis points in signed terms', () => {
  assert.deepEqual(parseGrantSettings(draft, false), { perTradeUsd: 25, dailyUsd: 50, maxSlippageBps: 50, durationHours: 24, allowSell: false });
  assert.equal(parseGrantSettings({ ...draft, slippagePercent: '0.29' }, false).maxSlippageBps, 29);
  assert.equal(parseGrantSettings({ ...draft, slippagePercent: '0.01' }, false).maxSlippageBps, 1);
});
test('rejects empty, nonfinite, out-of-range and overprecise limits', () => {
  for (const [key, values] of Object.entries({ perTradeUsd: ['', '0', '25.01', '0.001', 'NaN', 'Infinity'], dailyUsd: ['24.99', '50.01'], slippagePercent: ['', '0', '0.51', '0.005'], durationHours: ['', '0', '25', '1.5'] })) {
    for (const value of values) assert.throws(() => parseGrantSettings({ ...draft, [key]: value }, false), `${key}=${value}`);
  }
});
test('new grants include buys and sells when available, without a side selection', () => {
  assert.equal(parseGrantSettings(draft, true).allowSell, true);
  assert.equal(parseGrantSettings(draft, false).allowSell, false);
});
test('accepts higher owner limits only when advertised by the signer', () => {
  const larger = { ...draft, perTradeUsd: '125.50', dailyUsd: '600' };
  const caps = { maxPerTradeUsd: 100000, maxDailyUsd: 999999999.99 };
  assert.throws(() => parseGrantSettings(larger, true));
  assert.equal(parseGrantSettings(larger, true, 0, true, caps).perTradeUsd, 125.5);
  assert.equal(parseGrantSettings(larger, true, 0, true, caps).dailyUsd, 600);
  assert.throws(() => parseGrantSettings({ ...larger, dailyUsd: '125.49' }, true, 0, true, caps));
  assert.throws(() => parseGrantSettings({ ...larger, perTradeUsd: '100000.01', dailyUsd: '200000' }, true, 0, true, caps));
});
test('multi-day durations are available only within the policy limit', () => {
  assert.deepEqual(grantDurationOptions(72), [1, 6, 12, 24, 48, 72]);
  assert.deepEqual(grantDurationOptions(23), [1, 6, 12]);
  assert.equal(parseGrantSettings({ ...draft, durationHours: '72' }, false, 72).durationHours, 72);
  assert.throws(() => parseGrantSettings({ ...draft, durationHours: '72' }, false, 71));
  assert.throws(() => parseGrantSettings({ ...draft, durationHours: '73' }, false, 100));
});
test('until-revoked mode sends an explicit null duration', () => {
  assert.equal(parseGrantSettings(draft, false, 0, true).durationHours, null);
  assert.throws(() => parseGrantSettings(draft, false, 0));
});
test('production image builds require both trusted signer pins; previews remain read/review only', () => {
  const env = { NEXT_PUBLIC_DEPLOYMENT_ENV: 'production', NEXT_PUBLIC_MCP_SIGNER_QUORUM_ID: 'quorum', NEXT_PUBLIC_MCP_SIGNER_POLICY_ID: 'policy' };
  validateMcpSignerConfig(env);
  for (const key of ['NEXT_PUBLIC_MCP_SIGNER_QUORUM_ID', 'NEXT_PUBLIC_MCP_SIGNER_POLICY_ID'])
    assert.throws(() => validateMcpSignerConfig({ ...env, [key]: '' }), /Production chat trading requires/);
  validateMcpSignerConfig({ NEXT_PUBLIC_DEPLOYMENT_ENV: 'preview' });
});
