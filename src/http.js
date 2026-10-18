// -----------------------------------------------------------------------------
// The only network access: HTTPS requests to the Weheat sign-in host and to
// the Weheat API, and the errors they end with. The body read is bounded, the
// promise settles once, nothing secret ever goes into an error message.
// -----------------------------------------------------------------------------

import https from 'node:https';
import { LIMITS, TIMINGS } from './constants.js';

/**
 * A failed Weheat call. `kind`:
 * - `refused`: the sign-in host refused a code or the renewal token (400/401);
 * - `unauthorized`: the API refused the access token (401);
 * - `forbidden`: 403 of the API (this heat pump, or this account);
 * - `not_found`: 404;
 * - `rate_limited`: 429, `retryAfter` in ms when given;
 * - `unavailable`: 5xx;
 * - `network`, `timeout`: no answer;
 * - `bad_response`, `size`: not the expected answer; `http`: any other status.
 */
export class WeheatError extends Error {
  constructor(kind, message, { status, retryAfter, detail } = {}) {
    super(message);
    this.name = 'WeheatError';
    this.kind = kind;
    this.status = status;
    this.retryAfter = retryAfter;
    this.detail = detail;
  }
}

const NETWORK_REASONS = {
  ECONNREFUSED: 'connection refused',
  ECONNRESET: 'connection reset',
  EHOSTUNREACH: 'host unreachable',
  ENETUNREACH: 'network unreachable',
  ENOTFOUND: 'unknown host name',
  EAI_AGAIN: 'host name not resolved',
  ETIMEDOUT: 'connection timed out',
  EPIPE: 'connection closed',
};

/** A socket error -> WeheatError (never the request: it carries tokens). */
export function networkError(err) {
  if (err instanceof WeheatError) {
    return err;
  }
  return new WeheatError('network', NETWORK_REASONS[err?.code] ?? 'network error');
}

/** A short, secret-free reason for a log or a status message. */
export function errorReason(err) {
  if (err instanceof WeheatError) {
    return err.status ? `${err.message} (HTTP ${err.status})` : err.message;
  }
  return 'unexpected error';
}

/**
 * One HTTPS request; resolves `{ status, headers, body }` whatever the status.
 * The tests replace it (the app takes a `transport`).
 */
export function httpsTransport(
  url,
  {
    method = 'GET',
    headers = {},
    body,
    timeout = TIMINGS.requestTimeout,
    maxBytes = LIMITS.responseBytes,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== 'https:') {
      reject(new WeheatError('network', 'only HTTPS is used'));
      return;
    }
    let timer;
    let settled = false;
    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn(value);
      }
    };
    const req = https.request(target, { method, headers }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          settle(reject, new WeheatError('size', 'answer too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () =>
        settle(resolve, {
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
      res.on('error', (err) => settle(reject, networkError(err)));
    });
    timer = setTimeout(
      () => {
        settle(
          reject,
          new WeheatError('timeout', `no answer within ${Math.round(timeout / 1000)} s`),
        );
        req.destroy();
      },
      Math.max(1, timeout),
    );
    req.on('error', (err) => settle(reject, networkError(err)));
    req.end(body);
  });
}

/** Retry-After (seconds or an HTTP date) -> milliseconds, undefined when absent. */
export function parseRetryAfter(value, now = Date.now()) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/**
 * The JSON of a body, `undefined` when empty; `bad_response` when it is not
 * JSON. Keys that could reach a prototype are dropped.
 */
export function parseJson(body) {
  if (body === undefined || body === null || String(body).trim() === '') {
    return undefined;
  }
  try {
    return JSON.parse(body, (key, value) =>
      key === '__proto__' || key === 'constructor' || key === 'prototype' ? undefined : value,
    );
  } catch {
    throw new WeheatError('bad_response', 'Weheat sent an answer that is not JSON');
  }
}

/** The transient errors shared by both hosts: 429, 5xx. Undefined otherwise. */
export function transientError({ status, headers = {} }, now) {
  if (status === 429) {
    return new WeheatError('rate_limited', 'too many requests', {
      status,
      retryAfter: parseRetryAfter(headers['retry-after'], now),
    });
  }
  if (status >= 500) {
    return new WeheatError('unavailable', 'Weheat is unavailable', { status });
  }
  return undefined;
}
