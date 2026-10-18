// -----------------------------------------------------------------------------
// The configuration, and what /data keeps (file mode, repairs, caps).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, clientKey, normalizeConfig } from '../src/config.js';
import { HOUR, MINUTE } from '../src/constants.js';
import { fileStore, normalizeMemory } from '../src/store.js';

test('the configuration is normalized', () => {
  const config = normalizeConfig({
    client_id: ' abc ',
    client_secret: ' s ',
    redirect_uri: 'https://example.org/cb?x=1',
    poll_minutes: '1',
    language: 'EN',
  });
  assert.equal(config.clientId, 'abc');
  assert.equal(config.clientSecret, 's');
  assert.equal(config.redirectUri, 'https://example.org/cb?x=1');
  assert.equal(config.client, clientKey('abc'));
  assert.equal(config.pollMinutes, 2);
  assert.equal(config.language, 'en');
  const empty = normalizeConfig({ redirect_uri: 'javascript:alert(1)', poll_minutes: 'x' });
  assert.equal(empty.redirectUri, '');
  assert.equal(empty.client, '');
  assert.equal(empty.pollMinutes, DEFAULTS.poll_minutes);
  assert.equal(normalizeConfig({ poll_minutes: 999 }).pollMinutes, 60);
  assert.equal(normalizeConfig({ redirect_uri: 'https://a b' }).redirectUri, '');
  // HTTPS only, except a local address.
  assert.equal(normalizeConfig({ redirect_uri: 'http://gladys.lan/cb' }).redirectUri, '');
  assert.equal(
    normalizeConfig({ redirect_uri: 'http://localhost:8080/cb' }).redirectUri,
    'http://localhost:8080/cb',
  );
  assert.equal(
    normalizeConfig({ redirect_uri: 'http://127.0.0.1/cb' }).redirectUri,
    'http://127.0.0.1/cb',
  );
  // An id too long is refused, and so is its client key.
  const long = normalizeConfig({ client_id: 'x'.repeat(300) });
  assert.equal(long.clientId, '');
  assert.equal(long.client, '');
});

test('the memory: repaired, pauses capped, stops tied to a client', () => {
  const now = 1_000_000_000;
  const client = clientKey('abc');
  const memory = normalizeMemory(
    {
      session: { client, accessToken: 'a', refreshToken: 'r', expiresAt: now, obtainedAt: 1 },
      block: { kind: 'expired', client },
      pause: { kind: 'rate', until: now + 100 * HOUR },
      lastRenewAt: now + HOUR,
      pumps: { client, list: [{ id: 'abc-1', name: 'x', dhw: true }, { id: '../x' }] },
    },
    now,
  );
  assert.equal(memory.session.refreshToken, 'r');
  assert.equal(memory.block.kind, 'expired');
  assert.equal(memory.pause.until, now + 6 * HOUR);
  assert.equal(memory.lastRenewAt, now);
  assert.deepEqual(memory.pumps.list, [
    { id: 'abc-1', name: 'x', model: 'Weheat', serial: null, dhw: true },
  ]);
  const junk = normalizeMemory(
    {
      session: { client: 'nothex', refreshToken: 'r' },
      block: { kind: 'other', client },
      pause: { kind: '__proto__', until: now + MINUTE },
    },
    now,
  );
  assert.equal(junk.session, null);
  assert.equal(junk.block, null);
  assert.equal(junk.pause, null);
  assert.equal(
    normalizeMemory({ pause: { kind: 'unavailable', until: now - 1 } }, now).pause,
    null,
  );
  assert.deepEqual(normalizeMemory(null, now), {
    session: null,
    block: null,
    pause: null,
    lastRenewAt: null,
    lastCycleAt: null,
    pumps: null,
  });
  const backoff = normalizeMemory(
    { pause: { kind: 'backoff', until: now + 5 * HOUR }, lastCycleAt: now + HOUR },
    now,
  );
  assert.equal(backoff.pause.until, now + 30 * MINUTE, 'an error pause read back capped');
  assert.equal(backoff.lastCycleAt, now, 'a cycle in the future counts as now');
});

test('the state file is written whole, readable by its owner only', async () => {
  // Under data/ of the repository (ignored by git), never the system temp directory.
  const base = fileURLToPath(new URL('../data/', import.meta.url));
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, 'store-test-'));
  try {
    const path = join(dir, 'state.json');
    const store = fileStore(path);
    assert.equal(await store.load(), null);
    await Promise.all([store.save({ a: 1 }), store.save({ a: 2 })]);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { a: 2 });
    assert.deepEqual(await store.load(), { a: 2 });
    if (process.platform !== 'win32') {
      assert.equal((await stat(path)).mode & 0o777, 0o600);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
