// -----------------------------------------------------------------------------
// The Weheat third-party API (read only): the heat pumps of the account, the
// latest log of one heat pump, its energy totals. Paths of weheat
// (heat_pump_api.py, heat_pump_log_api.py, energy_log_api.py).
// -----------------------------------------------------------------------------

import { API_PATHS, WEHEAT } from './constants.js';
import { WeheatError, parseJson, transientError } from './http.js';

/** GET one path with the access token -> its JSON. */
export async function apiGet(transport, path, { token, now, timeout }) {
  const res = await transport(`${WEHEAT.apiUrl}${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    timeout,
  });
  const transient = transientError(res, now);
  if (transient) {
    throw transient;
  }
  switch (res.status) {
    case 200:
      break;
    case 401:
      throw new WeheatError('unauthorized', 'Weheat refused the access token', { status: 401 });
    case 403:
      throw new WeheatError('forbidden', 'Weheat refused this request', { status: 403 });
    case 404:
      throw new WeheatError('not_found', 'not found at Weheat', { status: 404 });
    default:
      throw new WeheatError('http', 'unexpected answer of Weheat', { status: res.status });
  }
  const data = parseJson(res.body);
  if (data === null || typeof data !== 'object') {
    throw new WeheatError('bad_response', 'Weheat sent an empty answer');
  }
  return data;
}

export const listHeatPumps = (transport, options) =>
  apiGet(transport, API_PATHS.heatPumps, options);

export const latestLog = (transport, id, options) =>
  apiGet(transport, API_PATHS.latestLog(id), options);

export const energyTotal = (transport, id, options) =>
  apiGet(transport, API_PATHS.energyTotal(id), options);
