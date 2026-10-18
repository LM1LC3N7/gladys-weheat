// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys and a fake Weheat behind the transport. Timers and Date are mocked:
// the tests move the clock.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { WeheatApp } from '../src/app.js';
import { clientKey } from '../src/config.js';
import { ACTIONS, OAUTH_FIELD } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { WeheatError } from '../src/http.js';
import {
  CLIENT_ID,
  CLIENT_SECRET,
  GLADYS_REDIRECT,
  HOUR,
  MINUTE,
  NOW,
  PUMP_A,
  PUMP_B,
  SECOND,
  logDto,
} from './fixtures/weheat.js';
import { answer, fakeWeheat, memoryStore, settle } from './helpers/fakeWeheat.js';

const CONFIG = { client_id: CLIENT_ID, client_secret: CLIENT_SECRET };
const device = (id) => `ext:test-integration:heatpump:${id}`;
const feature = (id, key) => `${device(id)}:${key}`;

/** A logger keeping every line, to check that no secret ever reaches the logs. */
const recorder = (logs) =>
  Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')),
    ]),
  );

async function setup(
  t,
  {
    config = CONFIG,
    store = memoryStore(),
    server = fakeWeheat(),
    now = NOW,
    signIn = store.data === null && Boolean(config.client_id),
    create = true,
    logs = [],
    mock = true,
  } = {},
) {
  if (mock) {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now });
  }
  const gladys = createFakeGladys({ config });
  const app = new WeheatApp({
    gladys,
    logger: recorder(logs),
    transport: server.transport,
    now: () => Date.now(),
    store,
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  const advance = async (ms, step = 10 * SECOND) => {
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
      t.mock.timers.tick(Math.min(step, ms - elapsed));
      await settle();
    }
  };
  const connect = async (redirect = GLADYS_REDIRECT) => {
    const ack = await gladys.fake.oauthAuthorizeUrl(OAUTH_FIELD, redirect);
    assert.equal(ack.success, true, JSON.stringify(ack));
    return server.approve(ack.data.authorize_url);
  };
  if (signIn) {
    assert.equal(server.requests.length, 0, 'nothing sent before the click');
    const back = await connect();
    const ack = await gladys.fake.oauthCallback(OAUTH_FIELD, back);
    assert.equal(ack.success, true, JSON.stringify(ack));
    await settle();
  }
  if (create) {
    for (const d of gladys.fake.discoveredDevices) {
      await gladys.fake.deviceCreated(d);
    }
    await advance(2 * SECOND, SECOND);
  }
  return { gladys, app, server, store, advance, connect, logs };
}

const message = (gladys) => gladys.fake.connectionStatus?.message ?? {};
const last = (gladys, id, key) => gladys.fake.lastState(feature(id, key));

test('without a client id, the status asks for it, nothing is sent and Connect refuses', async (t) => {
  const { gladys, server, advance } = await setup(t, { config: {} });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).fr, /identifiant client/);
  const ack = await gladys.fake.oauthAuthorizeUrl(OAUTH_FIELD, GLADYS_REDIRECT);
  assert.equal(ack.success, false);
  await advance(HOUR, 5 * MINUTE);
  assert.equal(server.requests.length, 0);
});

test('signed out: never a request by itself, Connect builds a PKCE address', async (t) => {
  const { gladys, server, advance, connect } = await setup(t, { signIn: false });
  assert.match(message(gladys).en, /Not signed in to Weheat: click Connect/);
  await advance(2 * HOUR, 10 * MINUTE);
  assert.equal(server.requests.length, 0);
  const ack = await gladys.fake.oauthAuthorizeUrl(OAUTH_FIELD, GLADYS_REDIRECT);
  const url = new URL(ack.data.authorize_url);
  assert.equal(
    `${url.origin}${url.pathname}`,
    'https://auth.weheat.nl/auth/realms/Weheat/protocol/openid-connect/auth/',
  );
  assert.equal(url.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(url.searchParams.get('redirect_uri'), GLADYS_REDIRECT);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('scope'), 'openid offline_access');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(url.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.ok(url.searchParams.get('state').length >= 16);
  assert.equal(url.searchParams.get('client_secret'), null, 'the secret never goes to the browser');
  await connect();
  assert.equal(server.requests.length, 0);
});

test('sign-in, then one read: devices, states, status, tokens in /data, nothing secret logged', async (t) => {
  const logs = [];
  const server = fakeWeheat({ pumps: [PUMP_A, PUMP_B] });
  const { gladys, store } = await setup(t, { server, logs });
  const [exchange] = server.of('token');
  assert.equal(exchange.form.grant_type, 'authorization_code');
  assert.equal(exchange.form.redirect_uri, GLADYS_REDIRECT);
  assert.equal(exchange.form.client_secret, CLIENT_SECRET);
  assert.ok(exchange.form.code_verifier.length >= 43);
  assert.deepEqual(
    server.apiRequests.slice(0, 5).map((r) => [r.route, r.id]),
    [
      ['list', undefined],
      ['log', PUMP_A],
      ['log', PUMP_B],
      ['energy', PUMP_A],
      ['energy', PUMP_B],
    ],
  );
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(message(gladys).en, /Connected to Weheat: 2 heat pump\(s\)/);

  const devices = gladys.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => d.external_id),
    [device(PUMP_A), device(PUMP_B)],
  );
  const a = devices[0];
  assert.equal(a.name, 'Blackbird garden');
  assert.ok(a.features.every((f) => f.read_only === true));
  assert.ok(a.features.some((f) => f.external_id === feature(PUMP_A, 'dhw_top')));
  assert.ok(
    !devices[1].features.some((f) => f.external_id === feature(PUMP_B, 'dhw_top')),
    'no tank, no tank temperatures',
  );

  assert.equal(last(gladys, PUMP_A, 'state'), 'Chauffage');
  assert.equal(last(gladys, PUMP_A, 'water_in'), 31.24);
  assert.equal(last(gladys, PUMP_A, 'outside'), 7.25);
  assert.equal(last(gladys, PUMP_A, 'room'), 20.4);
  assert.equal(last(gladys, PUMP_A, 'power_in'), 1000);
  assert.equal(last(gladys, PUMP_A, 'power_out'), 4200);
  assert.equal(last(gladys, PUMP_A, 'cop'), 4.2);
  assert.equal(last(gladys, PUMP_A, 'flow'), 1.05);
  assert.equal(last(gladys, PUMP_A, 'energy_in'), 1265);
  assert.equal(last(gladys, PUMP_A, 'energy_in_indoor'), 7);
  assert.equal(last(gladys, PUMP_A, 'energy_out'), 4585);
  assert.equal(last(gladys, PUMP_A, 'dhw_flow'), 0);

  const saved = store.data;
  assert.equal(saved.session.client, clientKey(CLIENT_ID));
  assert.equal(saved.session.refreshToken, server.refresh);
  assert.equal(saved.pumps.list.length, 2);
  assert.ok(!JSON.stringify(saved).includes(CLIENT_SECRET), 'the client secret stays in Gladys');
  assert.deepEqual(
    gladys.fake.transports.map((e) => e.transport),
    [DEVICE_TRANSPORTS.CLOUD, DEVICE_TRANSPORTS.CLOUD],
  );
  const text = logs.join('\n');
  for (const secret of [
    CLIENT_SECRET,
    server.access,
    server.refresh,
    exchange.form.code_verifier,
  ]) {
    assert.ok(!text.includes(secret), 'a secret reached the logs');
  }
});

test('a return to Gladys with an unknown or missing state is refused, nothing exchanged', async (t) => {
  const { gladys, server, connect } = await setup(t, { signIn: false });
  const back = await connect();
  let ack = await gladys.fake.oauthCallback(OAUTH_FIELD, { ...back, state: 'forged' });
  assert.equal(ack.success, false);
  ack = await gladys.fake.oauthCallback(OAUTH_FIELD, { ...back, state: undefined });
  assert.equal(ack.success, false);
  assert.equal(server.requests.length, 0);
  // The real one still works once, never twice.
  ack = await gladys.fake.oauthCallback(OAUTH_FIELD, back);
  assert.equal(ack.success, true);
  ack = await gladys.fake.oauthCallback(OAUTH_FIELD, back);
  assert.equal(ack.success, false);
});

test('a refused code tells the user, nothing is retried', async (t) => {
  const { gladys, server, connect, advance } = await setup(t, { signIn: false });
  const back = await connect();
  server.queue('token', answer(400, { error: 'invalid_grant' }));
  const ack = await gladys.fake.oauthCallback(OAUTH_FIELD, back);
  assert.equal(ack.success, false);
  assert.match(ack.error, /invalid_grant/);
  await advance(HOUR, 10 * MINUTE);
  assert.equal(server.requests.length, 1);
});

test('another redirect address: the pasted address finishes the sign-in', async (t) => {
  const redirect = 'https://my.example.org/weheat/return';
  const { gladys, server, connect } = await setup(t, {
    config: { ...CONFIG, redirect_uri: redirect },
    signIn: false,
  });
  const back = await connect();
  assert.equal(back.redirectUri, redirect, 'the configured address, not Gladys');
  let ack = await gladys.fake.action(ACTIONS.FINISH_SIGN_IN, { url: 'hello' });
  assert.match(ack.data.message.en, /No sign-in code/);
  ack = await gladys.fake.action(ACTIONS.FINISH_SIGN_IN, {
    url: `${redirect}?error=access_denied&state=${back.state}`,
  });
  assert.match(ack.data.message.en, /did not sign you in \(access_denied\)/);
  // Without its state, an address is never matched to a sign-in (no guess).
  ack = await gladys.fake.action(ACTIONS.FINISH_SIGN_IN, {
    url: `${redirect}?code=${back.code}`,
  });
  assert.match(ack.data.message.en, /No sign-in code/);
  // Another address than the redirect of the sign-in: refused, the sign-in stays usable.
  for (const other of [
    `https://evil.example/weheat/return?state=${back.state}&code=${back.code}`,
    `https://my.example.org/other?state=${back.state}&code=${back.code}`,
  ]) {
    ack = await gladys.fake.action(ACTIONS.FINISH_SIGN_IN, { url: other });
    assert.match(ack.data.message.en, /not the redirect address/);
  }
  assert.equal(server.requests.length, 0, 'nothing exchanged');
  ack = await gladys.fake.action(ACTIONS.FINISH_SIGN_IN, {
    url: `${redirect}?state=${back.state}&session_state=x&code=${back.code}`,
  });
  assert.match(ack.data.message.en, /Signed in to Weheat/);
  await settle();
  const [exchange] = server.of('token');
  assert.equal(exchange.form.redirect_uri, redirect);
  assert.equal(exchange.timeout, 10 * SECOND);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('the return relayed by Gladys: exchanged within 3.5 s, a slow Weheat asks for a new click', async (t) => {
  const { gladys, server, connect } = await setup(t, { signIn: false });
  const back = await connect();
  server.queue('token', async (request) => {
    assert.equal(request.timeout, 3500);
    throw new WeheatError('timeout', 'no answer within 4 s');
  });
  let ack = await gladys.fake.oauthCallback(OAUTH_FIELD, back);
  assert.equal(ack.success, false);
  assert.match(ack.error, /Weheat lent, cliquez de nouveau sur Connecter/);
  // The code may have been used: the same return is not exchanged again.
  ack = await gladys.fake.oauthCallback(OAUTH_FIELD, back);
  assert.equal(ack.success, false);
  assert.equal(server.of('token').length, 1);
  const again = await connect();
  ack = await gladys.fake.oauthCallback(OAUTH_FIELD, again);
  assert.equal(ack.success, true);
  assert.equal(server.of('token')[1].timeout, 3500);
});

test('the token is renewed by a timer before its end, never twice within a minute', async (t) => {
  const server = fakeWeheat({ expiresIn: 300 });
  const { advance, gladys } = await setup(t, { server });
  assert.equal(server.of('token').length, 1);
  // 300 s token: margin min(5 min, 150 s) -> renewed at 150 s.
  await advance(140 * SECOND);
  assert.equal(server.of('token').length, 1);
  await advance(20 * SECOND);
  assert.equal(server.of('token').length, 2);
  assert.equal(server.of('token')[1].form.grant_type, 'refresh_token');
  // A token of 10 s: never more than one renewal a minute.
  server.expiresIn = 10;
  await advance(10 * MINUTE, 5 * SECOND);
  const renewals = server.of('token').length - 2;
  assert.ok(renewals >= 1 && renewals <= 11, `${renewals} renewals in 10 minutes`);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a refused renewal stops everything, kept across a restart; only a sign-in resumes', async (t) => {
  const store = memoryStore();
  const server = fakeWeheat({ expiresIn: 300 });
  const { gladys, app, advance, connect } = await setup(t, { server, store });
  server.refresh = 'rotated-elsewhere';
  await advance(3 * MINUTE);
  assert.match(message(gladys).en, /session ended/);
  assert.equal(store.data.block.kind, 'expired');
  assert.equal(store.data.session, null);
  const before = server.requests.length;
  await advance(3 * HOUR, 10 * MINUTE);
  assert.equal(server.requests.length, before, 'nothing retried by itself');
  const test = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(test.data.message.en, /session ended/);
  assert.equal(server.requests.length, before);

  // A restart keeps the stop.
  app.stop();
  const again = await setup(t, { server, store, mock: false, create: false });
  assert.match(message(again.gladys).en, /session ended/);
  await again.advance(HOUR, 10 * MINUTE);
  assert.equal(server.requests.length, before);

  // A new sign-in lifts it.
  const back = await again.connect();
  const ack = await again.gladys.fake.oauthCallback(OAUTH_FIELD, back);
  assert.equal(ack.success, true);
  await settle();
  assert.equal(store.data.block, null);
  assert.equal(again.gladys.fake.connectionStatus.connected, true);
  void connect;
});

test('a 429 pauses every path, kept in /data across a restart and a reconnection', async (t) => {
  const store = memoryStore();
  const server = fakeWeheat({ expiresIn: 3600 });
  const { gladys, app, advance } = await setup(t, { server, store });
  server.queue('log', answer(429, { message: 'slow down' }, { 'retry-after': '1800' }));
  await advance(2 * MINUTE);
  assert.match(message(gladys).en, /HTTP 429\): pause of 30 min/);
  assert.equal(store.data.pause.kind, 'rate');
  const before = server.requests.length;
  // A reconnection to Gladys keeps the pause.
  await gladys.disconnect();
  await gladys.connect();
  await settle();
  const test = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(test.data.message.en, /HTTP 429/);
  await advance(20 * MINUTE, MINUTE);
  assert.equal(server.requests.length, before, 'nothing during the pause');
  // A restart keeps it too.
  app.stop();
  const again = await setup(t, { server, store, mock: false, create: false });
  assert.match(message(again.gladys).en, /HTTP 429/);
  await again.advance(5 * MINUTE, MINUTE);
  assert.equal(server.requests.length, before);
  await again.advance(10 * MINUTE, MINUTE);
  assert.ok(server.requests.length > before, 'read again after the pause');
  assert.equal(store.data.pause, null);
});

test('5xx on every heat pump: a pause kept in /data, never sooner than the interval', async (t) => {
  const store = memoryStore();
  const server = fakeWeheat({ expiresIn: 3600 });
  const { gladys, advance } = await setup(t, { server, store });
  server.queue('log', answer(503, {}), 1);
  await advance(2 * MINUTE);
  assert.match(message(gladys).en, /unavailable/);
  assert.equal(store.data.pause.kind, 'unavailable');
  const before = server.of('log').length;
  await advance(4 * MINUTE, 30 * SECOND);
  assert.equal(server.of('log').length, before);
  await advance(2 * MINUTE, 30 * SECOND);
  assert.equal(server.of('log').length, before + 1);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('the energy totals failing never stop the logs, and are not read again for 30 minutes', async (t) => {
  const server = fakeWeheat({ expiresIn: 3600 });
  const { gladys, advance } = await setup(t, { server, signIn: false, create: false });
  server.queue('energy', answer(500, {}));
  const back = await (async () => {
    const ack = await gladys.fake.oauthAuthorizeUrl(OAUTH_FIELD, GLADYS_REDIRECT);
    return server.approve(ack.data.authorize_url);
  })();
  await gladys.fake.oauthCallback(OAUTH_FIELD, back);
  await settle();
  for (const d of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(d);
  }
  await advance(2 * SECOND, SECOND);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(last(gladys, PUMP_A, 'water_out'), 36.5);
  assert.equal(last(gladys, PUMP_A, 'energy_in'), undefined);
  await advance(20 * MINUTE, MINUTE);
  assert.equal(server.of('energy').length, 1);
  assert.ok(server.of('log').length >= 10);
  await advance(12 * MINUTE, MINUTE);
  assert.equal(server.of('energy').length, 2);
  assert.equal(last(gladys, PUMP_A, 'energy_in'), 1265);
});

test('one heat pump failing never stops the other', async (t) => {
  const server = fakeWeheat({ pumps: [PUMP_A, PUMP_B], expiresIn: 3600 });
  const { gladys, advance } = await setup(t, { server });
  server.logs.delete(PUMP_B);
  server.logs.set(PUMP_A, logDto(PUMP_A, { tAirIn: 2.5 }));
  await advance(4 * MINUTE);
  assert.equal(last(gladys, PUMP_A, 'outside'), 2.5);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(message(gladys).en, /Not read this time: Sparrow garage/);
  const badges = gladys.fake.transports.filter((e) => e.device_external_id === device(PUMP_B));
  assert.equal(badges.at(-1).transport, DEVICE_TRANSPORTS.UNREACHABLE);
});

test('the list failing: the heat pumps kept in /data are still read', async (t) => {
  const store = memoryStore();
  const server = fakeWeheat({ expiresIn: 3600 });
  const first = await setup(t, { server, store });
  first.app.stop();
  server.queue('list', answer(500, {}));
  server.logs.set(PUMP_A, logDto(PUMP_A, { tWaterOut: 40 }));
  const before = server.requests.length;
  const { gladys, advance } = await setup(t, { server, store, mock: false });
  // A restart right after a cycle waits the interval before its first read.
  assert.equal(server.requests.length, before);
  await advance(2 * MINUTE);
  assert.equal(server.of('list').length, 2);
  assert.equal(last(gladys, PUMP_A, 'water_out'), 40);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  // The failing list is tried again 30 minutes later, not at every cycle.
  await advance(28 * MINUTE, MINUTE);
  assert.equal(server.of('list').length, 2);
  await advance(3 * MINUTE, MINUTE);
  assert.equal(server.of('list').length, 3);
});

test('an error pause and the last cycle are kept in /data: a restart never reads sooner', async (t) => {
  const store = memoryStore();
  const server = fakeWeheat({ expiresIn: 3600 });
  const first = await setup(t, { server, store, config: { ...CONFIG, poll_minutes: 10 } });
  server.queue('log', async () => {
    throw Object.assign(new Error('boom'), { code: 'ECONNRESET' });
  });
  await first.advance(10 * MINUTE);
  assert.equal(store.data.pause.kind, 'backoff');
  assert.equal(store.data.pause.until, Date.now() + 10 * MINUTE);
  assert.equal(store.data.lastCycleAt, Date.now());
  first.app.stop();
  const before = server.requests.length;
  const again = await setup(t, {
    server,
    store,
    mock: false,
    config: { ...CONFIG, poll_minutes: 10 },
  });
  await again.advance(9 * MINUTE, MINUTE);
  assert.equal(server.requests.length, before);
  await again.advance(2 * MINUTE, MINUTE);
  assert.ok(server.requests.length > before);
  assert.equal(store.data.pause, null);
});

test('a renewal due during a pause is not sent and never extends the pause', async (t) => {
  const store = memoryStore();
  const server = fakeWeheat({ expiresIn: 300 });
  const { advance } = await setup(t, { server, store });
  server.queue('log', answer(429, {}, { 'retry-after': '600' }));
  await advance(2 * MINUTE);
  const until = store.data.pause.until;
  assert.equal(until, Date.now() + 10 * MINUTE);
  assert.equal(server.of('token').length, 1);
  // The renewal (due at 150 s) waits for the end of the pause.
  await advance(9 * MINUTE, 10 * SECOND);
  assert.equal(server.of('token').length, 1);
  assert.equal(store.data.pause.until, until);
  await advance(2 * MINUTE, 10 * SECOND);
  assert.equal(server.of('token').length, 2);
});

test('a 401: one renewal and one retry; refused again, a stop only a click lifts', async (t) => {
  const store = memoryStore();
  const server = fakeWeheat({ expiresIn: 3600 });
  const { gladys, advance } = await setup(t, { server, store });
  // Revoked: the renewal gives a new token, accepted.
  server.revokeAccess();
  await advance(2 * MINUTE);
  assert.equal(server.of('token').length, 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  // Refused even with a new token.
  server.queue('log', answer(401, {}), 2);
  server.revokeAccess();
  await advance(2 * MINUTE);
  assert.match(message(gladys).en, /refused the access of this account/);
  assert.equal(store.data.block.kind, 'unauthorized');
  const before = server.requests.length;
  await advance(2 * HOUR, 10 * MINUTE);
  assert.equal(server.requests.length, before, 'nothing retried by itself');
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /Connected to Weheat/);
  assert.equal(store.data.block, null);
});

test('a network failure is never read again sooner than the interval', async (t) => {
  const server = fakeWeheat({ expiresIn: 3600 });
  const { gladys, advance } = await setup(t, { server, config: { ...CONFIG, poll_minutes: 10 } });
  const reject = () => {
    throw Object.assign(new Error('boom'), { code: 'ECONNRESET' });
  };
  server.queue('log', async () => reject());
  await advance(10 * MINUTE);
  assert.match(message(gladys).en, /could not be read/);
  const before = server.of('log').length;
  await advance(9 * MINUTE, MINUTE);
  assert.equal(server.of('log').length, before);
  await advance(2 * MINUTE, MINUTE);
  assert.equal(server.of('log').length, before + 1);
});

test('a reconnection to Gladys resends the status and the Discovery list', async (t) => {
  const server = fakeWeheat({ expiresIn: 3600 });
  const { gladys } = await setup(t, { server });
  const statuses = gladys.fake.connectionStatuses.length;
  const lists = gladys.fake.bodies('POST', '/discovered_device').length;
  await gladys.disconnect();
  await gladys.connect();
  await settle();
  assert.equal(gladys.fake.connectionStatuses.length, statuses + 1);
  assert.equal(gladys.fake.bodies('POST', '/discovered_device').length, lists + 1);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a created heat pump never loses a feature, even when its tank disappears', async (t) => {
  const server = fakeWeheat({ expiresIn: 3600 });
  const { gladys, app, advance } = await setup(t, { server });
  const before = gladys.fake.discoveredDevices[0].features.map((f) => f.external_id);
  server.pumps = [PUMP_A];
  const { pumpDto } = await import('./fixtures/weheat.js');
  server.queue('list', answer(200, { data: [pumpDto(PUMP_A, { dhwType: 0 })] }));
  await app.scan();
  await advance(2 * MINUTE);
  const after = gladys.fake.discoveredDevices[0].features.map((f) => f.external_id);
  for (const id of before) {
    assert.ok(after.includes(id), `${id} lost`);
  }
});

test('a new client id drops the session of the previous one', async (t) => {
  const server = fakeWeheat({ expiresIn: 3600 });
  const { gladys, advance } = await setup(t, { server });
  const before = server.requests.length;
  await gladys.fake.configUpdated({ client_id: 'another-client', client_secret: 'x' });
  await settle();
  assert.match(message(gladys).en, /Not signed in/);
  await advance(HOUR, 10 * MINUTE);
  assert.equal(server.requests.length, before);
});

test('the test button reads at once, then waits 30 seconds between clicks', async (t) => {
  const server = fakeWeheat({ expiresIn: 3600 });
  const { gladys } = await setup(t, { server });
  const before = server.of('log').length;
  let ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /Connected to Weheat/);
  assert.equal(server.of('log').length, before + 1);
  ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /less than 30 seconds/);
  assert.equal(server.of('log').length, before + 1);
});
