import assert from 'node:assert/strict';
import test from 'node:test';
import { validateGrantPermission as validate, validateTrustedTradeSigner } from '../services/mcp-grant-authorization.ts';
const trusted = { signerId: 'quorum', policyId: 'policy' };
const validateGrantPermission = (...args) => validate(...args, trusted);

const wallet = 'test-wallet';
const settings = { perTradeUsd: 0.1, dailyUsd: 0.2, maxSlippageBps: 50, allowSell: false, durationHours: 1 };
function fixture() {
  const now = Date.now();
  const value = { version: 1, appId: 'app', action: 'prepare', wallet,
    delegationId: 'grant', issuedAt: now, validUntil: now + 300000,
    signerId: 'quorum', policyId: 'policy', terms: { perTradeUsd: '0.100000', dailyUsd: '0.200000',
      maxSlippageBps: 50, allowSell: false, expiresAt: new Date(now + 3600000).toISOString() } };
  return { value, message: () => 'Oren chat trading permission\n' + JSON.stringify(value) };
}
test('browser accepts only the selected prepare limits', () => {
  const f = fixture();
  validateGrantPermission(f.message(), wallet, 'app', 'prepare', settings);
  f.value.terms.dailyUsd = '50.000000';
  assert.throws(() => validateGrantPermission(f.message(), wallet, 'app', 'prepare', settings), /limits differ/);
});
test('browser requires an explicit match between dated and until-revoked permission', () => {
  const f = fixture();
  const standing = { ...settings, durationHours: null };
  assert.throws(() => validateGrantPermission(f.message(), wallet, 'app', 'prepare', standing), /duration differs/);
  f.value.terms.expiresAt = null;
  validateGrantPermission(f.message(), wallet, 'app', 'prepare', standing);
  assert.throws(() => validateGrantPermission(f.message(), wallet, 'app', 'prepare', settings), /duration differs/);
});
for (const field of ['wallet', 'appId', 'action', 'expiry', 'duration', 'slippage', 'sell']) {
  test(`browser refuses changed ${field} before requesting a wallet signature`, () => {
    const f = fixture();
    if (field === 'wallet') f.value.wallet = 'other';
    if (field === 'appId') f.value.appId = 'other';
    if (field === 'action') f.value.action = 'activate';
    if (field === 'expiry') f.value.validUntil = Date.now() - 1000;
    if (field === 'duration') f.value.terms.expiresAt = new Date(Date.now() + 86400000).toISOString();
    if (field === 'slippage') f.value.terms.maxSlippageBps = 100;
    if (field === 'sell') f.value.terms.allowSell = true;
    assert.throws(() => validateGrantPermission(f.message(), wallet, 'app', 'prepare', settings));
  });
}
test('activation binds the exact displayed signer, policy, expiry and grant', () => {
  const f = fixture(); f.value.action = 'activate'; f.value.signerId = 'quorum'; f.value.policyId = 'policy';
  const review = { ...f.value.terms, delegationId: 'grant', signerId: 'quorum', policyId: 'policy', wallet };
  validateGrantPermission(f.message(), wallet, 'app', 'activate', review);
  f.value.signerId = 'other';
  assert.throws(() => validateGrantPermission(f.message(), wallet, 'app', 'activate', review), /signer/);
});
test('revocation cannot authorize new terms or target another grant', () => {
  const f = fixture(); f.value.action = 'revoke';
  assert.throws(() => validateGrantPermission(f.message(), wallet, 'app', 'revoke', { delegationId: 'grant' }));
  f.value.terms = null;
  f.value.signerId = null; f.value.policyId = null;
  validateGrantPermission(f.message(), wallet, 'app', 'revoke', { delegationId: 'grant' });
  assert.throws(() => validateGrantPermission(f.message(), wallet, 'app', 'revoke', { delegationId: 'other' }));
});
test('an API cannot enroll another signer or bypass missing web configuration', () => {
  assert.throws(() => validateTrustedTradeSigner({ signerId: 'attacker', policyId: 'any-policy' }, trusted));
  assert.throws(() => validateTrustedTradeSigner(trusted, { signerId: '', policyId: '' }));
  const f = fixture(); f.value.policyId = 'unreviewed-policy';
  assert.throws(() => validateGrantPermission(f.message(), wallet, 'app', 'prepare', settings));
});
