// -----------------------------------------------------------------------------
// The Weheat account: the OAuth2 authorization-code flow with PKCE (S256) of
// the Keycloak realm "Weheat", as Home Assistant runs it
// (LocalOAuth2ImplementationWithPkce, scopes "openid offline_access"), with
// the client id and secret Weheat gives for its third-party API.
//
// The browser goes to the Weheat sign-in page and comes back to the redirect
// address registered for that client:
//   - Gladys' own address (the Connect button of the `oauth2` field): Gladys
//     relays the code to onOAuthCallback;
//   - another one (configuration "redirect address"): the user pastes the
//     address the browser ended on into the "Finish the sign-in" action.
// The password is typed on the Weheat page only: it never reaches this code.
// Nothing here logs a token, a code or a verifier.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { LIMITS, TIMINGS, WEHEAT } from './constants.js';
import { WeheatError, parseJson, transientError } from './http.js';

const base64url = (buffer) => buffer.toString('base64url');

/** A PKCE pair (RFC 7636, S256). */
export function pkcePair() {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/**
 * The parameters of a pasted address: `{ code, state, error, errorDescription }`,
 * or null when nothing usable is in it. Takes the whole address, or only its
 * query string ("?code=…&state=…" or "code=…&state=…").
 */
export function parseRedirect(input) {
  const text = String(input ?? '')
    .trim()
    .slice(0, LIMITS.pastedLength);
  if (!text) {
    return null;
  }
  let query;
  if (/^https?:\/\//i.test(text)) {
    let url;
    try {
      url = new URL(text.split(/\s/)[0]);
    } catch {
      return null;
    }
    // Keycloak answers in the query (response_mode=query); a fragment is read too.
    query = `${url.search.slice(1)}&${url.hash.slice(1)}`;
  } else if (/^[?#]?(?:code|state|error|session_state|iss)=/.test(text)) {
    query = text.replace(/^[?#]/, '').split(/\s/)[0];
  } else {
    return null;
  }
  const params = new URLSearchParams(query);
  const code = params.get('code') || null;
  const result = {
    code: code && code.length <= LIMITS.codeLength ? code : null,
    state: params.get('state') || null,
    error: params.get('error') || null,
    errorDescription: params.get('error_description') || null,
  };
  return result.code || result.error ? result : null;
}

const str = (value) =>
  typeof value === 'string' && value !== '' && value.length <= LIMITS.tokenLength
    ? value
    : undefined;

/** The token answer -> the token kept, or null without an access token. */
export function tokenOf(data, now) {
  const accessToken = str(data?.access_token);
  if (!accessToken) {
    return null;
  }
  const expiresIn = Number(data.expires_in);
  const refreshIn = Number(data.refresh_expires_in);
  return {
    accessToken,
    refreshToken: str(data.refresh_token) ?? null,
    // Without an expiry, five minutes (Keycloak's default lifetime).
    expiresAt: now + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 300) * 1000,
    // Keycloak sends 0 for an offline token (no end).
    refreshExpiresAt: Number.isFinite(refreshIn) && refreshIn > 0 ? now + refreshIn * 1000 : null,
    obtainedAt: now,
  };
}

/**
 * The token endpoint, form-encoded (client_secret_post when a secret is set).
 * 400/401: `refused` (invalid_grant, invalid_client…), with the short OAuth
 * error as detail; 429 and 5xx: transient; anything else: `http`.
 */
export async function tokenRequest(transport, form, { clientId, clientSecret, now, timeout }) {
  const body = new URLSearchParams({
    ...form,
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
  }).toString();
  const res = await transport(WEHEAT.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
    timeout,
  });
  const transient = transientError(res, now);
  if (transient) {
    throw transient;
  }
  let data;
  try {
    data = parseJson(res.body);
  } catch (err) {
    if (res.status >= 400) {
      data = undefined;
    } else {
      throw err;
    }
  }
  // A 403 (a proxy in front of Keycloak) is not a refusal: it falls to `http` below.
  if (res.status === 400 || res.status === 401) {
    const reason = typeof data?.error === 'string' ? data.error.slice(0, 60) : `HTTP ${res.status}`;
    throw new WeheatError('refused', `Weheat refused the sign-in (${reason})`, {
      status: res.status,
      detail: reason,
    });
  }
  if (res.status !== 200) {
    throw new WeheatError('http', 'unexpected answer of the sign-in host', { status: res.status });
  }
  const token = tokenOf(data, now);
  if (!token) {
    throw new WeheatError('bad_response', 'no access token in the answer of Weheat');
  }
  return token;
}

/** The sign-ins started (Connect), waiting for their code: state -> { verifier, redirectUri, at }. */
export class SignIns {
  constructor({ now }) {
    this.now = now;
    this.pending = new Map();
  }

  /** The authorization address of a new sign-in. */
  begin({ clientId, redirectUri }) {
    const now = this.now();
    for (const [state, entry] of this.pending) {
      if (now - entry.at > TIMINGS.signInTtl) {
        this.pending.delete(state);
      }
    }
    while (this.pending.size >= LIMITS.signIns) {
      this.pending.delete(this.pending.keys().next().value);
    }
    const state = base64url(randomBytes(16));
    const { verifier, challenge } = pkcePair();
    this.pending.set(state, { verifier, redirectUri, at: now });
    const url = new URL(WEHEAT.authorizeUrl);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', WEHEAT.scope);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  /** The sign-in of `state` (the newest one when the address has none); it serves once. */
  take(state) {
    const key = state || [...this.pending.keys()].at(-1);
    const entry = key ? this.pending.get(key) : undefined;
    if (!entry) {
      return null;
    }
    this.pending.delete(key);
    return this.now() - entry.at <= TIMINGS.signInTtl ? { key, entry } : null;
  }

  /** Put a sign-in back (Weheat was not reached: the same code may be tried again). */
  restore({ key, entry }) {
    this.pending.set(key, entry);
  }

  clear() {
    this.pending.clear();
  }
}
