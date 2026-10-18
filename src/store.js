// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container), never a password (it is typed on the Weheat page only):
//   - the session: the access and renewal tokens with their ends, and the
//     client they belong to (a hash of the client id);
//   - a stop that only the user can lift (renewal refused, access refused
//     with a fresh token), with its client, so a restart never retries it;
//   - the end of a 429, 5xx or error pause, capped when read again, and when
//     the last read cycle started (a restart never reads sooner);
//   - when the token was last renewed (never two renewals within a minute);
//   - the heat pumps last listed, so a failing list never stops the reads.
// The tokens are kept as Weheat gives them, in clear, in a file readable by
// the container user only (0600).
// -----------------------------------------------------------------------------

import { open, readFile, rename } from 'node:fs/promises';
import { LIMITS, TIMINGS } from './constants.js';

export const STATE_FILE = '/data/weheat-state.json';

export function fileStore(path = STATE_FILE) {
  // One write at a time: two saves never share the temporary file.
  let chain = Promise.resolve();
  return {
    async load() {
      try {
        return JSON.parse(await readFile(path, 'utf8'));
      } catch {
        return null;
      }
    },
    save(data) {
      const text = JSON.stringify(data);
      const write = chain.then(async () => {
        const temporary = `${path}.tmp`;
        const file = await open(temporary, 'w', 0o600);
        try {
          await file.chmod(0o600);
          await file.writeFile(text);
          // On disk before it replaces the previous state (a power cut keeps one of the two).
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temporary, path);
      });
      chain = write.catch(() => {});
      return write;
    },
  };
}

const time = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const str = (value, max) =>
  typeof value === 'string' && value !== '' && value.length <= max ? value : undefined;
const client = (value) =>
  typeof value === 'string' && /^[0-9a-f]{16}$/.test(value) ? value : undefined;

const BLOCKS = new Set(['expired', 'unauthorized']);
const PAUSES = {
  rate: TIMINGS.rateLimitMax,
  unavailable: TIMINGS.unavailable.at(-1),
  backoff: TIMINGS.backoffMax,
};

function session(raw) {
  const s = raw?.session;
  const owner = client(s?.client);
  const refreshToken = str(s?.refreshToken, LIMITS.tokenLength);
  if (!owner || !refreshToken) {
    return null;
  }
  return {
    client: owner,
    accessToken: str(s.accessToken, LIMITS.tokenLength) ?? null,
    refreshToken,
    expiresAt: time(s.expiresAt) ?? 0,
    refreshExpiresAt: time(s.refreshExpiresAt) ?? null,
    obtainedAt: time(s.obtainedAt) ?? 0,
  };
}

function pumps(raw) {
  const p = raw?.pumps;
  const owner = client(p?.client);
  if (!owner || !Array.isArray(p.list)) {
    return null;
  }
  const list = [];
  for (const pump of p.list.slice(0, LIMITS.pumps)) {
    const id = str(pump?.id, 64);
    if (!id || !/^[a-z0-9-]+$/.test(id)) {
      continue;
    }
    list.push({
      id,
      name: str(pump.name, 100) ?? 'Weheat',
      model: str(pump.model, 100) ?? 'Weheat',
      serial: str(pump.serial, 64) ?? null,
      dhw: pump.dhw === true,
    });
  }
  return { client: owner, list };
}

/** The persisted state, repaired; the pause end is capped from `now`. */
export function normalizeMemory(raw, now = Date.now()) {
  const block = raw?.block;
  const pause = raw?.pause;
  const until = time(pause?.until);
  const lastRenewAt = time(raw?.lastRenewAt);
  const lastCycleAt = time(raw?.lastCycleAt);
  return {
    session: session(raw),
    block:
      BLOCKS.has(block?.kind) && client(block?.client)
        ? { kind: block.kind, client: block.client }
        : null,
    pause:
      pause && Object.hasOwn(PAUSES, pause.kind) && until !== undefined && until > now
        ? { kind: pause.kind, until: Math.min(until, now + PAUSES[pause.kind]) }
        : null,
    // A time ahead of the clock counts as now (never a renewal blocked for long).
    lastRenewAt: lastRenewAt === undefined ? null : Math.min(lastRenewAt, now),
    // The start of the last read cycle: the first read after a restart waits the interval.
    lastCycleAt: lastCycleAt === undefined ? null : Math.min(lastCycleAt, now),
    pumps: pumps(raw),
  };
}
