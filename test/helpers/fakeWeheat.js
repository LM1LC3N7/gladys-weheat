// -----------------------------------------------------------------------------
// A fake Weheat behind the transport of the app: the Keycloak token endpoint
// (authorization code with PKCE, refresh token) and the third-party API.
// Every request is recorded; `queue(route, answer)` injects one answer.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import {
  CLIENT_ID,
  CLIENT_SECRET,
  PUMP_A,
  energyDto,
  listDto,
  logDto,
} from '../fixtures/weheat.js';

const TOKEN_URL = 'https://auth.weheat.nl/auth/realms/Weheat/protocol/openid-connect/token/';
const API = 'https://api.weheat.nl/third_party';

export const settle = async (rounds = 30) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

/** /data in memory. */
export function memoryStore(data = null) {
  return {
    data,
    saves: 0,
    async load() {
      return this.data === null ? null : JSON.parse(JSON.stringify(this.data));
    },
    async save(value) {
      this.saves += 1;
      this.data = JSON.parse(JSON.stringify(value));
    },
  };
}

const json = (status, body, headers = {}) => ({
  status,
  headers: { 'content-type': 'application/json', ...headers },
  body: body === undefined ? '' : JSON.stringify(body),
});

export function fakeWeheat({ pumps = [PUMP_A], expiresIn = 300 } = {}) {
  const server = {
    requests: [],
    pumps,
    expiresIn,
    logs: new Map(pumps.map((id) => [id, logDto(id)])),
    energy: new Map(pumps.map((id) => [id, energyDto(id)])),
    issued: 0,
    access: null,
    refresh: null,
    /** code -> { challenge, redirectUri, clientId } */
    codes: new Map(),
    queued: { token: [], list: [], log: [], energy: [] },
    queue(route, answer, times = 1) {
      for (let i = 0; i < times; i += 1) {
        this.queued[route].push(answer);
      }
    },
    /** The user signs in on the Weheat page of `authorizeUrl`: the code and state of the return. */
    approve(authorizeUrl) {
      const url = new URL(authorizeUrl);
      const code = `code-${this.codes.size + 1}`;
      this.codes.set(code, {
        challenge: url.searchParams.get('code_challenge'),
        redirectUri: url.searchParams.get('redirect_uri'),
        clientId: url.searchParams.get('client_id'),
      });
      return {
        code,
        state: url.searchParams.get('state'),
        redirectUri: url.searchParams.get('redirect_uri'),
      };
    },
    revokeAccess() {
      this.access = 'revoked';
    },
    issue() {
      this.issued += 1;
      this.access = `access-${this.issued}`;
      this.refresh = `refresh-${this.issued}`;
      return json(200, {
        access_token: this.access,
        refresh_token: this.refresh,
        expires_in: this.expiresIn,
        refresh_expires_in: 0,
        token_type: 'Bearer',
        scope: 'openid offline_access',
      });
    },
    of(route) {
      return this.requests.filter((r) => r.route === route);
    },
    get apiRequests() {
      return this.requests.filter((r) => r.route !== 'token');
    },
    transport: async (url, { method = 'GET', headers = {}, body } = {}) => {
      const request = { url, method, headers, body, route: undefined, form: undefined };
      server.requests.push(request);
      if (url === TOKEN_URL) {
        request.route = 'token';
        request.form = Object.fromEntries(new URLSearchParams(body));
        const injected = server.queued.token.shift();
        if (injected) {
          return typeof injected === 'function' ? injected(request) : injected;
        }
        const form = request.form;
        if (form.client_id !== CLIENT_ID || form.client_secret !== CLIENT_SECRET) {
          return json(401, { error: 'invalid_client' });
        }
        if (form.grant_type === 'authorization_code') {
          const entry = server.codes.get(form.code);
          server.codes.delete(form.code);
          const challenge = createHash('sha256')
            .update(form.code_verifier ?? '')
            .digest('base64url');
          if (!entry || entry.challenge !== challenge || entry.redirectUri !== form.redirect_uri) {
            return json(400, { error: 'invalid_grant' });
          }
          return server.issue();
        }
        if (form.grant_type === 'refresh_token') {
          if (form.refresh_token !== server.refresh) {
            return json(400, { error: 'invalid_grant', error_description: 'Token is not active' });
          }
          return server.issue();
        }
        return json(400, { error: 'unsupported_grant_type' });
      }
      const path = url.startsWith(API) ? url.slice(API.length) : url;
      let route;
      let id;
      let match;
      if (path === '/api/v1/heat-pumps?page=1&pageSize=1000&State=3') {
        route = 'list';
      } else if ((match = /^\/api\/v1\/heat-pumps\/([^/]+)\/logs\/latest$/.exec(path))) {
        route = 'log';
        id = match[1];
      } else if ((match = /^\/api\/v1\/energy-logs\/([^/]+)\/total$/.exec(path))) {
        route = 'energy';
        id = match[1];
      } else {
        return json(404, { message: 'not found' });
      }
      request.route = route;
      request.id = id;
      const injected = server.queued[route].shift();
      if (injected) {
        return typeof injected === 'function' ? injected(request) : injected;
      }
      if (headers.Authorization !== `Bearer ${server.access}` || !server.access) {
        return json(401, { message: 'Unauthorized' });
      }
      if (route === 'list') {
        return json(200, listDto(server.pumps));
      }
      const table = route === 'log' ? server.logs : server.energy;
      return table.has(id) ? json(200, table.get(id)) : json(404, { message: 'not found' });
    },
  };
  return server;
}

export const answer = json;
