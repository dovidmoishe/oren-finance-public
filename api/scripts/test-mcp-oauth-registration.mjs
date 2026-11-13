import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { PgDialect } from 'drizzle-orm/pg-core'

const require = createRequire(import.meta.url)
const express = require(
  require.resolve('express', {
    paths: [require.resolve('@nestjs/platform-express')],
  }),
)
const request = require('supertest')
const { requireMcpOfflineConsent } = require('../dist/src/mcp-auth/offline-consent.js')
const { mcpConsentScopes } = require('../dist/src/mcp-auth/consent-scopes.js')
const {
  createMcpOAuthRuntime,
  mcpInteractionUrl,
  mountPathBasedDiscoveryAtIssuer,
} = require('../dist/src/mcp-auth/oauth-runtime.js')
const {
  describeMcpConsentClient,
  nativeMcpConsentGranted,
} = require('../dist/src/mcp-auth/client-consent.js')

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const signingKey = {
  ...privateKey.export({ format: 'jwk' }),
  kid: 'registration-test',
  alg: 'RS256',
  use: 'sig',
}
const stored = new Map()
const dialect = new PgDialect()
function matchingRow(condition) {
  const { params } = dialect.sqlToQuery(condition)
  return [...stored.values()].find(
    (item) =>
      params.includes(item.model) &&
      (params.includes(item.key) || params.includes(item.uidHash)),
  )
}
const db = {
  insert: () => ({
    values: (row) => ({
      onConflictDoUpdate: async () => {
        stored.set(String(row.key), row)
      },
    }),
  }),
  select: () => ({
    from: () => ({
      where: (condition) => ({
        limit: async () => {
          const row = matchingRow(condition)
          return row ? [{ payload: row.payload }] : []
        },
      }),
    }),
  }),
  delete: () => ({
    where: async (condition) => {
      const row = matchingRow(condition)
      if (row) stored.delete(row.key)
    },
  }),
  update: () => ({
    set: () => ({
      where: (condition) => ({
        returning: async () => {
          const row = matchingRow(condition)
          if (!row || row.payload.consumed) return []
          row.payload = {
            ...row.payload,
            consumed: Math.floor(Date.now() / 1000),
          }
          return [{ key: row.key }]
        },
      }),
    }),
  }),
}
const runtime = await createMcpOAuthRuntime(db, {
  NODE_ENV: 'test',
  MCP_OAUTH_ENABLED: 'true',
  MCP_OAUTH_ISSUER: 'https://api.oren.finance/oauth',
  MCP_APP_ORIGIN: 'https://oren.finance',
  MCP_OAUTH_STORAGE_KEY: randomBytes(32).toString('base64'),
  MCP_OAUTH_COOKIE_KEYS: `${randomBytes(32).toString('hex')},${randomBytes(32).toString('hex')}`,
  MCP_OAUTH_JWKS: JSON.stringify({ keys: [signingKey] }),
})
assert.ok(runtime)
const app = express()
app.get('/oauth/interaction/:uid', async (req, res) => {
  try {
    const details = await runtime.provider.interactionDetails(req, res)
    if (details.uid !== req.params.uid) return res.sendStatus(403)
    if (req.query.launch === '1')
      return res.redirect(
        303,
        `${runtime.appOrigin}/connect/mcp?uid=${encodeURIComponent(details.uid)}`,
      )
    const client = await runtime.provider.Client.find(details.params.client_id)
    const presentation = client && describeMcpConsentClient(client, details.params.redirect_uri)
    if (!presentation) return res.sendStatus(403)
    return res.json({ clientId: details.params.client_id, ...presentation })
  } catch {
    return res.sendStatus(400)
  }
})
app.post('/oauth/interaction/:uid', async (req, res) => {
  try {
    const details = await runtime.provider.interactionDetails(req, res)
    if (details.uid !== req.params.uid) return res.sendStatus(403)
    const client = await runtime.provider.Client.find(details.params.client_id)
    const presentation = client && describeMcpConsentClient(client, details.params.redirect_uri)
    if (!presentation || !nativeMcpConsentGranted(presentation, req.headers['x-oren-native-client-consent']))
      return res.sendStatus(403)
    const grant = new runtime.provider.Grant({
      accountId: 'disposable-test-user',
      clientId: details.params.client_id,
    })
    const scopes = mcpConsentScopes(details.params.scope, false)
    if (!scopes) return res.sendStatus(403)
    grant.addResourceScope(runtime.resource, scopes.resourceScopes)
    grant.addOIDCScope(scopes.oidcScopes)
    const grantId = await grant.save()
    const redirect = await runtime.provider.interactionResult(
      req,
      res,
      {
        login: {
          accountId: 'disposable-test-user',
          amr: ['email_otp'],
          remember: false,
        },
        consent: { grantId },
      },
      { mergeWithLastSubmission: false },
    )
    return res.json({ redirect })
  } catch {
    return res.sendStatus(400)
  }
})
app.use('/.well-known/oauth-authorization-server/oauth', (req, res) => {
  mountPathBasedDiscoveryAtIssuer(req)
  return runtime.provider.callback()(req, res)
})
const { mcpRegistrationBody } = require('../dist/src/mcp-auth/mcp-json-body.js')
app.post('/oauth/reg', mcpRegistrationBody)
app.get('/oauth/auth', requireMcpOfflineConsent)
app.use('/oauth', runtime.provider.callback())
const pathMetadata = await request(app)
  .get('/.well-known/oauth-authorization-server/oauth')
  .set('Host', 'api.oren.finance')
  .set('X-Forwarded-Host', 'api.oren.finance')
  .set('X-Forwarded-Proto', 'https')
assert.equal(pathMetadata.status, 200, JSON.stringify(pathMetadata.body))
assert.equal(
  pathMetadata.body.authorization_endpoint,
  'https://api.oren.finance/oauth/auth',
)
assert.equal(
  pathMetadata.body.token_endpoint,
  'https://api.oren.finance/oauth/token',
)
assert.equal(
  pathMetadata.body.registration_endpoint,
  'https://api.oren.finance/oauth/reg',
)
const metadata = await request(app)
  .get('/oauth/.well-known/openid-configuration')
  .set('Host', 'api.oren.finance')
  .set('X-Forwarded-Host', 'api.oren.finance')
  .set('X-Forwarded-Proto', 'https')
assert.equal(metadata.status, 200, JSON.stringify(metadata.body))
assert.equal(
  metadata.body.registration_endpoint,
  'https://api.oren.finance/oauth/reg',
)
const registration = await request(app)
  .post('/oauth/reg')
  .send({
    redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
    token_endpoint_auth_method: 'none',
    response_types: ['code'],
    grant_types: ['authorization_code', 'refresh_token'],
    client_name: 'Oren test',
    scope: 'oren.read oren.trade.prepare offline_access',
  })
assert.equal(registration.status, 201, JSON.stringify(registration.body))
assert.equal(registration.body.token_endpoint_auth_method, 'none')
assert.equal(
  registration.body.scope,
  'oren.read oren.trade.prepare offline_access',
)
assert.deepEqual(registration.body.redirect_uris, [
  'https://claude.ai/api/mcp/auth_callback',
])
assert.equal(typeof registration.body.client_id, 'string')
assert.ok(stored.size > 0)
const verifier = 'a'.repeat(64)
const challenge = createHash('sha256').update(verifier).digest('base64url')
const authorization = await request(app)
  .get('/oauth/auth')
  .query({
    client_id: registration.body.client_id,
    redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    response_type: 'code',
    scope: 'oren.read oren.trade.prepare offline_access',
    resource: 'https://api.oren.finance/mcp',
    state: 'registration-test',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  .set('Host', 'api.oren.finance')
  .set('X-Forwarded-Host', 'api.oren.finance')
  .set('X-Forwarded-Proto', 'https')
assert.equal(authorization.status, 303, JSON.stringify(authorization.body))
const launch = new URL(authorization.headers.location)
assert.equal(launch.origin, 'https://api.oren.finance')
assert.equal(launch.searchParams.get('launch'), '1')
assert.equal(
  launch.href,
  mcpInteractionUrl(runtime.issuer, launch.pathname.split('/').at(-1)),
)
const cookie = authorization.headers['set-cookie']?.find((value) =>
  value.startsWith('_interaction='),
)
assert.ok(cookie, 'interaction cookie must be set')
assert.ok(
  cookie.toLowerCase().includes(`path=${launch.pathname.toLowerCase()}`),
  `interaction cookie path ${cookie.match(/path=[^;]*/i)?.[0]} must match ${launch.pathname}`,
)
const cookiePair = authorization.headers['set-cookie']
  .map((value) => value.split(';')[0])
  .join('; ')
const forwarded = {
  Host: 'api.oren.finance',
  'X-Forwarded-Host': 'api.oren.finance',
  'X-Forwarded-Proto': 'https',
  Cookie: cookiePair,
}
const landing = await request(app)
  .get(`${launch.pathname}${launch.search}`)
  .set(forwarded)
assert.equal(landing.status, 303, 'API launch must accept its scoped cookie')
assert.equal(new URL(landing.headers.location).pathname, '/connect/mcp')
const details = await request(app).get(launch.pathname).set(forwarded)
assert.equal(
  details.status,
  200,
  'app detail request must accept the same cookie',
)
assert.equal(details.body.clientId, registration.body.client_id)
const wrongInteraction = await request(app)
  .get('/oauth/interaction/wrong-uid')
  .set(forwarded)
assert.equal(
  wrongInteraction.status,
  403,
  'cookie must not access another interaction URL',
)
const missingCookie = await request(app).get(launch.pathname)
assert.equal(
  missingCookie.status,
  400,
  'interaction details require the cookie',
)
const consent = await request(app)
  .post(launch.pathname)
  .set({ ...forwarded, Origin: runtime.appOrigin })
assert.equal(consent.status, 200, 'consent must persist a grant')
const resume = await request(app)
  .get(new URL(consent.body.redirect).pathname)
  .set(forwarded)
assert.equal(resume.status, 303, 'completed consent must leave Oren')
assert.equal(
  new URL(resume.headers.location).origin,
  'https://claude.ai',
  'completed consent must return to Claude instead of starting another prompt',
)
const callback = new URL(resume.headers.location)
assert.equal(callback.searchParams.get('state'), 'registration-test')
const code = callback.searchParams.get('code')
assert.ok(code, 'Claude callback must contain an authorization code')
const token = await request(app)
  .post('/oauth/token')
  .type('form')
  .send({
    grant_type: 'authorization_code',
    client_id: registration.body.client_id,
    code,
    code_verifier: verifier,
    redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
  })
  .set('Host', 'api.oren.finance')
  .set('X-Forwarded-Host', 'api.oren.finance')
  .set('X-Forwarded-Proto', 'https')
assert.equal(token.status, 200, 'Claude must be able to exchange the code')
assert.equal(token.body.token_type, 'Bearer')
assert.equal(typeof token.body.access_token, 'string')
assert.equal(typeof token.body.refresh_token, 'string')
assert.ok(token.body.scope?.includes('oren.read'))
assert.ok(token.body.scope?.includes('oren.trade.prepare'))
const disallowed = await request(app)
  .post('/oauth/reg')
  .send({
    redirect_uris: ['https://attacker.example/callback'],
    token_endpoint_auth_method: 'none',
    response_types: ['code'],
    grant_types: ['authorization_code'],
  })
assert.equal(disallowed.status, 400)
const unsupportedScope = await request(app)
  .post('/oauth/reg')
  .send({
    redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
    token_endpoint_auth_method: 'none',
    response_types: ['code'],
    grant_types: ['authorization_code'],
    scope: 'oren.read oren.trade.execute',
  })
assert.equal(unsupportedScope.status, 400)
async function register(redirectUris, scope = 'oren.read oren.trade.prepare offline_access') {
  return request(app)
    .post('/oauth/reg')
    .send({
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
      response_types: ['code'],
      grant_types: ['authorization_code', 'refresh_token'],
      scope,
    })
}
const cursor = await register([
  'https://www.cursor.com/agents/mcp/oauth/callback',
  'http://localhost:8787/callback',
  'cursor://anysphere.cursor-mcp/oauth/callback',
])
assert.equal(cursor.status, 201, JSON.stringify(cursor.body))
assert.equal(cursor.body.scope, 'oren.read oren.trade.prepare offline_access')
const codex = await register(['http://127.0.0.1:49152/callback/Abcdef12_-'], 'openid oren.read oren.trade.prepare offline_access')
assert.equal(codex.status, 201, JSON.stringify(codex.body))
const mixed = await register([
  'https://claude.ai/api/mcp/auth_callback',
  'http://127.0.0.1:49152/callback',
])
assert.equal(mixed.status, 400)

// Use the actual provider to verify selected callbacks, native consent and PKCE.
const proxyHeaders = {
  Host: 'api.oren.finance',
  'X-Forwarded-Host': 'api.oren.finance',
  'X-Forwarded-Proto': 'https',
}
async function completeConnection(registration, redirectUri, nativeConsent, intercepted = false) {
  const verifier = randomBytes(48).toString('base64url')
  const query = {
    client_id: registration.body.client_id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: registration.body.scope,
    resource: runtime.resource,
    state: randomBytes(16).toString('hex'),
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }
  const missingPkce = await request(app).get('/oauth/auth').query({ ...query, code_challenge: undefined, code_challenge_method: undefined }).set(proxyHeaders)
  assert.equal(missingPkce.status, 303)
  const pkceError = new URL(missingPkce.headers.location)
  assert.equal(pkceError.searchParams.get('error'), 'invalid_request', 'public clients cannot authorize without PKCE')
  assert.equal(pkceError.searchParams.get('code'), null)
  const start = await request(app).get('/oauth/auth').query(query).set(proxyHeaders)
  assert.equal(start.status, 303)
  const interactionPath = new URL(start.headers.location).pathname
  const headers = { ...proxyHeaders, Cookie: start.headers['set-cookie'].map((value) => value.split(';')[0]).join('; ') }
  const details = await request(app).get(interactionPath).set(headers)
  assert.equal(details.status, 200)
  assert.equal(details.body.callbackUrl, redirectUri)
  assert.equal(details.body.requiresNativeConsent, nativeConsent)
  if (nativeConsent) {
    const refused = await request(app).post(interactionPath).set({ ...headers, Origin: runtime.appOrigin })
    assert.equal(refused.status, 403, 'native consent cannot be skipped')
  }
  const consent = await request(app).post(interactionPath).set({ ...headers, Origin: runtime.appOrigin, ...(nativeConsent ? { 'X-Oren-Native-Client-Consent': 'true' } : {}) })
  assert.equal(consent.status, 200)
  const resumed = await request(app).get(new URL(consent.body.redirect).pathname).set(headers)
  assert.equal(resumed.status, 303)
  const callback = new URL(resumed.headers.location)
  assert.equal(callback.searchParams.get('state'), query.state)
  const code = callback.searchParams.get('code')
  assert.ok(code)
  const cookies = new Map()
  for (const response of [start, consent, resumed]) {
    for (const cookie of response.headers['set-cookie'] ?? []) {
      const pair = cookie.split(';')[0]
      const equals = pair.indexOf('=')
      cookies.set(pair.slice(0, equals), pair.slice(equals + 1))
    }
  }
  const sessionHeaders = { ...proxyHeaders, Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') }
  // Even an existing browser session/grant must visit Oren's consent again.
  const silent = await request(app).get('/oauth/auth').query({ ...query, prompt: 'none' }).set(sessionHeaders)
  assert.equal(silent.status, 303)
  const silentCallback = new URL(silent.headers.location)
  assert.equal(silentCallback.searchParams.get('error'), registration.body.application_type === 'native' ? 'interaction_required' : 'consent_required')
  assert.equal(silentCallback.searchParams.get('code'), null)
  const repeated = await request(app).get('/oauth/auth').query(query).set(sessionHeaders)
  assert.equal(repeated.status, 303)
  const repeatedLocation = new URL(repeated.headers.location)
  assert.equal(repeatedLocation.origin, 'https://api.oren.finance')
  assert.ok(repeatedLocation.pathname.startsWith('/oauth/interaction/'))
  const exchange = (codeVerifier) => request(app).post('/oauth/token').set(proxyHeaders).type('form').send({
    grant_type: 'authorization_code', client_id: registration.body.client_id,
    code, code_verifier: codeVerifier, redirect_uri: redirectUri,
  })
  if (intercepted) {
    const denied = await exchange(randomBytes(48).toString('base64url'))
    assert.equal(denied.status, 400, 'intercepted code cannot be redeemed without its verifier')
    assert.equal(denied.body.error, 'invalid_grant')
  } else {
    const token = await exchange(verifier)
    assert.equal(token.status, 200)
    assert.equal(typeof token.body.access_token, 'string')
    const renew = (refreshToken, scope = query.scope) => request(app).post('/oauth/token').set(proxyHeaders).type('form').send({
      grant_type:'refresh_token',client_id:registration.body.client_id,
      refresh_token:refreshToken,resource:runtime.resource,scope,
    })
    const excessive = await renew(token.body.refresh_token, query.scope + ' oren.trade.execute')
    assert.equal(excessive.status,400,'refresh must not add ungranted trade scope')
    assert.equal(excessive.body.error,'invalid_scope')
    const refreshed = await request(app).post('/oauth/token').set(proxyHeaders).type('form').send({
      grant_type: 'refresh_token', client_id: registration.body.client_id,
      refresh_token: token.body.refresh_token, resource: runtime.resource, scope: query.scope,
    })
    assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body))
    assert.equal(typeof refreshed.body.access_token, 'string')
    assert.notEqual(refreshed.body.refresh_token,token.body.refresh_token,'refresh token must rotate')
    const access = await runtime.provider.AccessToken.find(refreshed.body.access_token)
    assert.equal(access.aud,runtime.resource)
    assert.deepEqual([...access.scopes].sort(),['oren.read','oren.trade.prepare'])
    const nextRefresh = await renew(refreshed.body.refresh_token)
    assert.equal(nextRefresh.status,200,'rotated token must retain the same requested renewal scopes')
    assert.equal((await exchange(verifier)).status, 400, 'authorization code is single-use')
  }
}
await completeConnection(registration, 'https://claude.ai/api/mcp/auth_callback', false)
await completeConnection(cursor, 'https://www.cursor.com/agents/mcp/oauth/callback', false)
await completeConnection(cursor, 'http://localhost:49153/callback', true)
await completeConnection(cursor, 'cursor://anysphere.cursor-mcp/oauth/callback', true)
await completeConnection(codex, 'http://127.0.0.1:49152/callback/Abcdef12_-', true)
await completeConnection(codex, 'http://127.0.0.1:49152/callback/Abcdef12_-', true, true)
console.log(
  'MCP OAuth discovery, registration, selected callback/native consent, PKCE interception rejection, and token exchange pass',
)
