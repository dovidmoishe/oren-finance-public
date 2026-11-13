import { mcpConsentScopes } from './consent-scopes';

it('accepts the actual Codex OAuth request while separating identity from financial permissions', () => {
  expect(
    mcpConsentScopes(
      'openid oren.read oren.trade.prepare oren.trade.execute offline_access',
      true,
    ),
  ).toEqual({
    requested: [
      'openid',
      'oren.read',
      'oren.trade.prepare',
      'oren.trade.execute',
      'offline_access',
    ],
    resourceScopes: ['oren.read', 'oren.trade.prepare', 'oren.trade.execute'],
    oidcScopes: [
      'openid',
      'oren.read',
      'oren.trade.prepare',
      'oren.trade.execute',
      'offline_access',
    ],
  });
});
it('preserves existing Claude scopes without granting unrequested identity or execute access', () => {
  expect(
    mcpConsentScopes('oren.read oren.trade.prepare offline_access', true),
  ).toEqual({
    requested: ['oren.read', 'oren.trade.prepare', 'offline_access'],
    resourceScopes: ['oren.read', 'oren.trade.prepare'],
    oidcScopes: ['oren.read', 'oren.trade.prepare', 'offline_access'],
  });
});
it.each([
  'openid',
  'openid offline_access',
  '',
  'openid profile oren.read',
  'openid oren.trade.execute',
])('rejects unsupported scopes or identity-only requests: %s', (scope) => {
  expect(mcpConsentScopes(scope, false)).toBeUndefined();
});
