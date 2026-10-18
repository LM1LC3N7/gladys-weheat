// -----------------------------------------------------------------------------
// OAuth2 pieces: PKCE, the pasted address, the token answer, the token
// endpoint errors, the sign-ins waiting for their code.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SignIns, parseRedirect, pkcePair, tokenOf, tokenRequest } from '../src/oauth.js';
import { answer } from './helpers/fakeWeheat.js';

test('PKCE: S256 of the verifier', () => {
  const { verifier, challenge } = pkcePair();
  assert.ok(verifier.length >= 43 && verifier.length <= 128);
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
});

test('the pasted address: whole, query only, fragment, error, junk', () => {
  assert.deepEqual(parseRedirect('https://x.example/cb?state=s1&session_state=z&code=c1'), {
    code: 'c1',
    state: 's1',
    error: null,
    errorDescription: null,
  });
  assert.equal(parseRedirect('  https://x.example/cb?code=c2&state=s2  trailing').code, 'c2');
  assert.equal(parseRedirect('?code=c3&state=s3').state, 's3');
  assert.equal(parseRedirect('code=c4').code, 'c4');
  assert.equal(parseRedirect('https://x.example/cb#state=s5&code=c5').code, 'c5');
  assert.equal(parseRedirect('https://x.example/cb?error=access_denied').error, 'access_denied');
  assert.equal(parseRedirect('https://x.example/cb?state=only'), null);
  assert.equal(parseRedirect('hello'), null);
  assert.equal(parseRedirect(''), null);
  assert.equal(parseRedirect(undefined), null);
  assert.equal(parseRedirect(`?code=${'a'.repeat(5000)}`), null, 'an oversized code is refused');
});

test('the token answer: expiry, renewal token, offline token without end', () => {
  const token = tokenOf(
    { access_token: 'a', refresh_token: 'r', expires_in: 300, refresh_expires_in: 0 },
    1000,
  );
  assert.deepEqual(token, {
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: 301_000,
    refreshExpiresAt: null,
    obtainedAt: 1000,
  });
  assert.equal(tokenOf({ access_token: 'a' }, 0).expiresAt, 300_000);
  assert.equal(tokenOf({ access_token: 'a' }, 0).refreshToken, null);
  assert.equal(tokenOf({}, 0), null);
  assert.equal(tokenOf(null, 0), null);
});

const run = (res) =>
  tokenRequest(
    async () => res,
    { grant_type: 'refresh_token', refresh_token: 'r' },
    {
      clientId: 'c',
      clientSecret: '',
      now: 0,
      timeout: 1000,
    },
  );

test('the token endpoint: refusals, transient errors, and the form sent', async () => {
  await assert.rejects(run(answer(400, { error: 'invalid_grant' })), {
    kind: 'refused',
    detail: 'invalid_grant',
  });
  await assert.rejects(run(answer(401, { error: 'invalid_client' })), { kind: 'refused' });
  await assert.rejects(run({ status: 401, headers: {}, body: '<html>' }), { kind: 'refused' });
  await assert.rejects(run(answer(403, {})), { kind: 'http', status: 403 });
  await assert.rejects(run(answer(429, {}, { 'retry-after': '120' })), {
    kind: 'rate_limited',
    retryAfter: 120_000,
  });
  await assert.rejects(run(answer(502, {})), { kind: 'unavailable' });
  await assert.rejects(run({ status: 200, headers: {}, body: 'nope' }), { kind: 'bad_response' });
  await assert.rejects(run(answer(200, { token_type: 'Bearer' })), { kind: 'bad_response' });
  let sent;
  await tokenRequest(
    async (url, options) => {
      sent = { url, ...options };
      return answer(200, { access_token: 'a', refresh_token: 'r', expires_in: 60 });
    },
    { grant_type: 'refresh_token', refresh_token: 'r' },
    { clientId: 'c', clientSecret: 's', now: 0, timeout: 1000 },
  );
  assert.equal(sent.method, 'POST');
  assert.equal(sent.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(sent.body)), {
    grant_type: 'refresh_token',
    refresh_token: 'r',
    client_id: 'c',
    client_secret: 's',
  });
});

test('a sign-in serves once and for 15 minutes', () => {
  let now = 0;
  const signIns = new SignIns({ now: () => now });
  const url = new URL(signIns.begin({ clientId: 'c', redirectUri: 'https://g/cb' }));
  const state = url.searchParams.get('state');
  assert.ok(signIns.take(state));
  assert.equal(signIns.take(state), null);
  const second = new URL(signIns.begin({ clientId: 'c', redirectUri: 'https://g/cb' }));
  now = 16 * 60_000;
  assert.equal(signIns.take(second.searchParams.get('state')), null);
  for (let i = 0; i < 8; i += 1) {
    signIns.begin({ clientId: 'c', redirectUri: 'https://g/cb' });
  }
  assert.ok(signIns.pending.size <= 5);
});
