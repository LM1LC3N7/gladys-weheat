// -----------------------------------------------------------------------------
// Manifest keys, Weheat constants, limits and timings.
//
// The hosts, the OAuth endpoints, the scopes and the API paths are those of
// weheat (MIT, wefabricate/wh-python 2026.9.3, the official library of the
// manufacturer) and of the Weheat integration of Home Assistant
// (homeassistant/components/weheat, const.py).
// -----------------------------------------------------------------------------

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

/** OAuth2 (Keycloak realm "Weheat") and the third-party API. */
export const WEHEAT = {
  authorizeUrl: 'https://auth.weheat.nl/auth/realms/Weheat/protocol/openid-connect/auth/',
  tokenUrl: 'https://auth.weheat.nl/auth/realms/Weheat/protocol/openid-connect/token/',
  apiUrl: 'https://api.weheat.nl/third_party',
  scope: 'openid offline_access',
};

/** The paths of the API, under WEHEAT.apiUrl. */
export const API_PATHS = {
  // HeatPumpDiscovery.async_discover_active: page 1, 1000 per page, active (DeviceState 3).
  heatPumps: '/api/v1/heat-pumps?page=1&pageSize=1000&State=3',
  latestLog: (id) => `/api/v1/heat-pumps/${encodeURIComponent(id)}/logs/latest`,
  energyTotal: (id) => `/api/v1/energy-logs/${encodeURIComponent(id)}/total`,
};

/** The `oauth2` field of the manifest `config_schema` (the Connect button). */
export const OAUTH_FIELD = 'account';

export const ACTIONS = {
  FINISH_SIGN_IN: 'finish_sign_in',
  TEST_CONNECTION: 'test_connection',
};

/** Refresh interval of the heat pump logs, in minutes. */
export const POLL_MINUTES = { min: 2, max: 60, default: 2 };

export const TIMINGS = {
  /** Home Assistant: 120 s per heat pump (the interval grows with their number). */
  perPump: 2 * MINUTE,
  /** The energy totals: every 30 minutes (Home Assistant ENERGY_UPDATE_INTERVAL). */
  energyInterval: 30 * MINUTE,
  /** The list of heat pumps: at start, on a scan, then every 6 hours. */
  listInterval: 6 * HOUR,
  requestTimeout: 15 * SECOND,
  /** A button waits less (actions time out after 60 s). */
  quickTimeout: 10 * SECOND,
  /** The code exchange of Gladys' OAuth return: Gladys waits for its answer. */
  callbackTimeout: 3500,
  /** A pause after an ordinary error, kept in /data, read back capped at this. */
  backoffMax: 30 * MINUTE,
  /** The list failing while heat pumps are known: tried again 30 minutes later. */
  listRetry: 30 * MINUTE,
  /** Renewed this long before its end (at most half of its lifetime). */
  tokenMargin: 5 * MINUTE,
  /** Never two renewals within a minute (a token shorter than the margin, a clock ahead). */
  renewFloor: MINUTE,
  /** A renewal that did not reach Weheat: tried again after 1, 5, 15, then 60 minutes. */
  renewRetry: [MINUTE, 5 * MINUTE, 15 * MINUTE, HOUR],
  /** 429: Retry-After when given, within 1 minute and 6 hours; 15 minutes without it. */
  rateLimitMin: MINUTE,
  rateLimitMax: 6 * HOUR,
  rateLimitDefault: 15 * MINUTE,
  /** 5xx: 5, 15, 30, then 60 minutes (never sooner than the interval). */
  unavailable: [5 * MINUTE, 15 * MINUTE, 30 * MINUTE, HOUR],
  /** Other failures: never sooner than the interval, then 5, 15, 30 minutes. */
  backoff: [5 * MINUTE, 15 * MINUTE, 30 * MINUTE],
  /** A sign-in started (Connect) can be finished for 15 minutes. */
  signInTtl: 15 * MINUTE,
  testCooldown: 30 * SECOND,
  /** An unchanged state is sent again every 30 minutes. */
  stateHeartbeat: 30 * MINUTE,
  flushInterval: SECOND,
};

export const LIMITS = {
  /** Gladys: 300 states per minute; a margin is kept. */
  statesPerMinute: 250,
  statesPerRequest: 100,
  /** A log or a list of a few heat pumps: far below. */
  responseBytes: 1024 * 1024,
  pumps: 20,
  signIns: 5,
  /** Authorization codes, tokens: bounded before they are kept. */
  codeLength: 4096,
  tokenLength: 16384,
  pastedLength: 8192,
};
