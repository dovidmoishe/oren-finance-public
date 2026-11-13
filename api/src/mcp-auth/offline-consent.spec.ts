import { mcpOfflineConsentUrl } from './offline-consent';

it('requires the browser consent needed to retain the exact Codex renewal scope', () => {
  const original =
    '/oauth/auth?response_type=code&scope=openid+oren.read+oren.trade.prepare+oren.trade.execute+offline_access&state=a%2Bb&code_challenge=abc_-&code_challenge_method=S256&redirect_uri=http%3A%2F%2F127.0.0.1%3A59001%2Fcallback&resource=https%3A%2F%2Fapi.oren.finance%2Fmcp';
  const before = new URL(original, 'https://api.oren.finance');
  const after = new URL(
    mcpOfflineConsentUrl(original),
    'https://api.oren.finance',
  );
  expect(after.searchParams.get('prompt')).toBe('consent');
  for (const [key, value] of before.searchParams)
    expect(after.searchParams.get(key)).toBe(value);
  expect(after.pathname).toBe(before.pathname);
});

it.each([
  '/oauth/auth?response_type=code&scope=oren.read',
  '/oauth/auth?response_type=code&scope=offline_access&prompt=none',
  '/oauth/auth?response_type=code&scope=offline_access&prompt=login',
  '/oauth/auth?response_type=code&scope=offline_access&prompt=consent',
  '/oauth/auth?response_type=token&scope=offline_access',
  '/oauth/auth?response_type=code&scope=offline_access&request=signed-object',
  '/oauth/auth?response_type=code&scope=offline_access&request_uri=https%3A%2F%2Fclient.example%2Frequest',
])(
  'preserves explicit prompts, signed requests and flows without renewal: %s',
  (url) => {
    expect(mcpOfflineConsentUrl(url)).toBe(url);
  },
);
