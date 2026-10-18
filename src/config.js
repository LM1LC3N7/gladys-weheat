// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { POLL_MINUTES } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  poll_minutes: POLL_MINUTES.default,
  language: 'fr',
};

export const LANGUAGES = ['fr', 'en'];

/** A short hash of the client id: the session in /data belongs to it. */
export const clientKey = (clientId) =>
  createHash('sha256').update(clientId).digest('hex').slice(0, 16);

const bounded = (raw, { min, max, default: fallback }) => {
  const value = Number(raw);
  return raw === null || raw === '' || !Number.isFinite(value)
    ? fallback
    : Math.round(Math.max(min, Math.min(max, value)));
};

/** An http(s) address without spaces, or '' (a wrong one is ignored). */
function address(raw) {
  const text = String(raw ?? '').trim();
  if (!text || text.length > 2048 || /\s/.test(text)) {
    return '';
  }
  try {
    const url = new URL(text);
    return ['https:', 'http:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

export function normalizeConfig(raw = {}) {
  const clientId = String(raw?.client_id ?? '').trim();
  const language = String(raw?.language ?? DEFAULTS.language)
    .trim()
    .toLowerCase();
  return {
    clientId: clientId.length <= 256 ? clientId : '',
    clientSecret: String(raw?.client_secret ?? '').trim(),
    redirectUri: address(raw?.redirect_uri),
    client: clientId ? clientKey(clientId) : '',
    pollMinutes: bounded(raw?.poll_minutes, POLL_MINUTES),
    language: LANGUAGES.includes(language) ? language : DEFAULTS.language,
  };
}
