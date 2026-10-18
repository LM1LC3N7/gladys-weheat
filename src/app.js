// -----------------------------------------------------------------------------
// The integration: the Weheat account (OAuth2 with PKCE, started by a click),
// the token renewed by a timer before its end, one read of the latest log of
// every heat pump per cycle (2 minutes per heat pump at least, as Home
// Assistant), the energy totals every 30 minutes, the list of heat pumps
// every 6 hours, the Gladys devices and their states (read only), the
// transport badges and the configuration buttons. index.js only wires the
// SDK handlers to it.
//
// Never by itself: a sign-in, a retry of a refused renewal, a read sooner
// than the interval after an error. Pauses (429, 5xx) and stops are kept in
// /data; a reconnection to Gladys resends the status and the Discovery list
// without touching them.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { energyTotal, latestLog, listHeatPumps } from './api.js';
import { normalizeConfig } from './config.js';
import { LIMITS, MINUTE, SECOND, TIMINGS } from './constants.js';
import { buildDevice, deviceIds, deviceStates } from './devices.js';
import { WeheatError, errorReason, httpsTransport, networkError } from './http.js';
import { T, age, join } from './i18n.js';
import { parseEnergy, parseLog, parsePumps } from './model.js';
import { SignIns, parseRedirect, tokenRequest } from './oauth.js';
import { StatePublisher } from './publisher.js';
import { fileStore, normalizeMemory } from './store.js';

/** The stops kept in /data: only the user lifts them. */
const PERSISTED = new Set(['expired', 'unauthorized']);
/** Their status message, and those of the stops that are not kept. */
const STOP_MESSAGES = {
  no_client: T.noClient,
  signed_out: T.signedOut,
  expired: T.expired,
  unauthorized: T.unauthorized,
};
/** Errors after which the account counts as unreachable (badges). */
const OFFLINE = new Set(['network', 'timeout', 'unavailable', 'bad_response', 'size', 'http']);
/** The fields of a Gladys feature that a publication carries. */
const FEATURE_FIELDS = [
  'name',
  'external_id',
  'category',
  'type',
  'unit',
  'min',
  'max',
  'read_only',
  'has_feedback',
  'keep_history',
];
/** An access token closer than this to its end is not used (renewed first). */
const TOKEN_SLACK = 10 * SECOND;

/** One message in both languages, for an error thrown to Gladys. */
const thrown = (message) => new Error(`${message.en} / ${message.fr}`);

export class WeheatApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'weheat' }),
    transport = httpsTransport,
    now = Date.now,
    timers = globalThis,
    store = fileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    // A socket error becomes a WeheatError (`network`), whatever the transport.
    this.transport = async (...args) => {
      try {
        return await transport(...args);
      } catch (err) {
        throw networkError(err);
      }
    };
    this.now = now;
    this.timers = timers;
    this.store = store;
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
    this.signIns = new SignIns({ now });
    this.config = normalizeConfig();
    this.memory = normalizeMemory(null);
    /** Moved on by every sign-in: a renewal started before it is dropped. */
    this.epoch = 0;
    this.generation = 0;
    this.timer = undefined;
    this.renewTimer = undefined;
    this.running = undefined;
    this.renewing = undefined;
    this.started = false;
    this.lastStatus = undefined;
    this.lastTestAt = -Infinity;
    /** Every device published in this run, by external id: a publication never shrinks. */
    this.known = new Map();
    this.reset();
  }

  /** Forgets the account state of this run. A 429 or 5xx pause stays. */
  reset() {
    this.pumps = [];
    this.logs = new Map();
    this.energy = new Map();
    /** pump id -> when its energy totals are due. */
    this.energyAt = new Map();
    /** The pumps whose log could not be read in the last cycle. */
    this.failedPumps = new Set();
    this.listAt = -Infinity;
    this.published = undefined;
    this.badges = new Map();
    /** undefined | 'no_client' | 'signed_out' | 'expired' | 'unauthorized' */
    this.blocked = undefined;
    this.offline = false;
    this.connectedOnce = false;
    this.failures = 0;
    this.renewFailures = 0;
    this.renewRetryAt = 0;
    this.renewError = undefined;
    this.cycleStart = -Infinity;
    if (!['rate', 'unavailable'].includes(this.pauseKind) || this.now() >= this.pausedUntil) {
      this.pausedUntil = 0;
      /** 'rate' (429), 'unavailable' (5xx): every path waits, kept in /data; 'backoff': the reads. */
      this.pauseKind = undefined;
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    this.stop();
    await this.running;
    this.config = normalizeConfig(raw);
    this.reset();
    this.signIns.clear();
    this.memory = normalizeMemory(await this.store.load().catch(() => null), this.now());
    const pause = this.memory.pause;
    if (pause && pause.until > Math.max(this.now(), this.pausedUntil)) {
      this.pausedUntil = pause.until;
      this.pauseKind = pause.kind;
    }
    this.publisher.start();
    const { client } = this.config;
    if (!client) {
      this.blocked = 'no_client';
      await this.setStatus(false, T.noClient);
      return;
    }
    if (this.memory.pumps?.client === client) {
      this.pumps = this.memory.pumps.list;
      await this.publishDevices();
    }
    if (this.memory.block?.client === client) {
      // A stop on this very client survives a restart (never retried by itself).
      this.blocked = this.memory.block.kind;
      await this.setStatus(false, STOP_MESSAGES[this.blocked]);
      return;
    }
    if (!this.session) {
      this.blocked = 'signed_out';
      await this.setStatus(false, T.signedOut);
      return;
    }
    await this.setStatus(false, this.pauseMessage() ?? T.connecting);
    this.scheduleRenew();
    await this.tick();
  }

  stop() {
    this.generation += 1;
    this.clearTimer();
    this.clearRenewTimer();
    this.publisher.stop();
  }

  clearTimer() {
    if (this.timer) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  clearRenewTimer() {
    if (this.renewTimer) {
      this.timers.clearTimeout(this.renewTimer);
      this.renewTimer = undefined;
    }
  }

  /** The session of the configured client, or null. */
  get session() {
    const s = this.memory.session;
    return s && s.client === this.config.client ? s : null;
  }

  /**
   * Connected to Gladys. The first time, start; after a reconnection (Gladys
   * restarted), resend what Gladys keeps in memory only (status, Discovery
   * list, badges). The pauses, the stops and the session stay.
   */
  async connected(raw = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    await this.configUpdated(raw);
    this.published = undefined;
    this.badges = new Map();
    const status = this.lastStatus;
    this.lastStatus = undefined;
    if (status) {
      const [connected, message] = JSON.parse(status);
      await this.setStatus(connected, message ?? undefined);
    }
    await this.publishDevices();
    await this.publishBadges();
  }

  /** A new client restarts; a new interval reschedules; a new language renames. */
  async configUpdated(raw = {}) {
    const next = normalizeConfig(raw);
    const previous = this.config;
    if (next.clientId !== previous.clientId) {
      return this.start(raw);
    }
    this.config = next;
    if (next.pollMinutes !== previous.pollMinutes && this.timer) {
      this.scheduleNext();
    }
    if (next.language !== previous.language) {
      this.published = undefined;
      await this.publishDevices();
      this.queueStates();
      await this.flush();
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  get lastMessage() {
    return JSON.parse(this.lastStatus ?? '[false,null]')[1] ?? undefined;
  }

  async saveMemory() {
    await this.store
      .save(this.memory)
      .catch((err) => this.logger.warn(`Saving the state to /data failed: ${err.message}`));
  }

  async flush() {
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
  }

  /** The read interval: the configured one, 2 minutes per heat pump at least. */
  get interval() {
    return Math.max(
      this.config.pollMinutes * MINUTE,
      TIMINGS.perPump * Math.max(1, this.pumps.length),
    );
  }

  // --- Pauses and stops ----------------------------------------------------------

  /** A 429 or a 5xx: a pause of every path, kept in /data. Returns its length. */
  async pause(err) {
    let wait;
    if (err.kind === 'rate_limited') {
      wait = Math.min(
        TIMINGS.rateLimitMax,
        Math.max(TIMINGS.rateLimitMin, err.retryAfter ?? TIMINGS.rateLimitDefault),
      );
      this.pauseKind = 'rate';
    } else {
      const step = TIMINGS.unavailable[Math.min(this.failures, TIMINGS.unavailable.length - 1)];
      wait = Math.max(this.interval, step);
      this.pauseKind = 'unavailable';
      this.offline = true;
    }
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + wait);
    this.memory.pause = { kind: this.pauseKind, until: this.pausedUntil };
    await this.saveMemory();
    return this.pausedUntil - this.now();
  }

  /** The message of a 429 or 5xx pause still running, for every path. */
  pauseMessage() {
    const left = this.pausedUntil - this.now();
    if (left <= 0) {
      return undefined;
    }
    if (this.pauseKind === 'rate') {
      return T.rateLimited(age(left));
    }
    return this.pauseKind === 'unavailable' ? T.unavailable(age(left)) : undefined;
  }

  get hardPaused() {
    return ['rate', 'unavailable'].includes(this.pauseKind) && this.now() < this.pausedUntil;
  }

  /** A stop only the user lifts: kept in /data with its client. */
  async block(kind) {
    this.blocked = kind;
    this.clearTimer();
    if (kind === 'expired') {
      // The renewal token is useless now: a new sign-in replaces it.
      this.memory.session = null;
      this.clearRenewTimer();
    }
    if (PERSISTED.has(kind)) {
      this.memory.block = { kind, client: this.config.client };
    }
    await this.saveMemory();
    this.logger.warn(`Weheat stopped: ${kind}`);
    await this.setStatus(false, STOP_MESSAGES[kind]);
    await this.publishBadges();
  }

  // --- Token renewal ----------------------------------------------------------

  /**
   * The renewal timer: at the end of the token minus a margin (5 minutes, at
   * most half of its lifetime), never within a minute of the last renewal,
   * nor during a 429 / 5xx pause, nor before the next try after a failure.
   */
  scheduleRenew() {
    this.clearRenewTimer();
    const s = this.session;
    if (!s || PERSISTED.has(this.blocked)) {
      return;
    }
    const lifetime = Math.max(0, s.expiresAt - s.obtainedAt);
    const margin = Math.min(TIMINGS.tokenMargin, lifetime / 2);
    let at = Math.max(
      s.expiresAt - margin,
      (this.memory.lastRenewAt ?? -Infinity) + TIMINGS.renewFloor,
      this.renewRetryAt,
    );
    if (this.hardPaused) {
      at = Math.max(at, this.pausedUntil);
    }
    const generation = this.generation;
    this.renewTimer = this.timers.setTimeout(
      () => {
        this.renewTimer = undefined;
        if (generation !== this.generation) {
          return;
        }
        this.renew().catch((err) => this.renewFailed(err, generation));
      },
      Math.max(0, at - this.now()),
    );
  }

  /** A renewal of the timer failed: a pause, a later try, or a stop (refused). */
  async renewFailed(err, generation) {
    if (generation !== this.generation || this.blocked) {
      return;
    }
    this.logger.info(`Weheat: token renewal failed (${errorReason(err)})`);
    if (err.kind === 'rate_limited' || err.kind === 'unavailable') {
      await this.pause(err);
      await this.setStatus(this.connectedOnce && err.kind === 'rate_limited', this.pauseMessage());
    } else if (err.kind === 'renew_wait') {
      // A renewal ran less than a minute ago: the timer comes back after it.
    } else if (this.session && this.now() >= this.session.expiresAt) {
      await this.setStatus(
        false,
        T.renewWaiting(errorReason(err), age(this.renewRetryAt - this.now())),
      );
    }
    this.scheduleRenew();
  }

  /** One renewal at a time. */
  renew(timeout) {
    if (!this.renewing) {
      this.renewing = this.doRenew(timeout).finally(() => {
        this.renewing = undefined;
      });
    }
    return this.renewing;
  }

  async doRenew(timeout = TIMINGS.requestTimeout) {
    const s = this.session;
    if (!s || this.blocked) {
      throw new WeheatError('signed_out', 'not signed in to Weheat');
    }
    const now = this.now();
    if (now < (this.memory.lastRenewAt ?? -Infinity) + TIMINGS.renewFloor) {
      throw new WeheatError('renew_wait', 'renewed less than a minute ago');
    }
    if (this.hardPaused) {
      throw new WeheatError(this.pauseKind === 'rate' ? 'rate_limited' : 'unavailable', 'paused', {
        retryAfter: this.pausedUntil - now,
      });
    }
    const epoch = this.epoch;
    this.memory.lastRenewAt = now;
    let token;
    try {
      token = await tokenRequest(
        this.transport,
        { grant_type: 'refresh_token', refresh_token: s.refreshToken },
        {
          clientId: this.config.clientId,
          clientSecret: this.config.clientSecret,
          now,
          timeout,
        },
      );
    } catch (err) {
      if (epoch !== this.epoch) {
        // A sign-in finished meanwhile: this failure belongs to the old session.
        throw new WeheatError('renew_wait', 'a new sign-in replaced the session');
      }
      if (err.kind === 'refused') {
        // Never tried again by itself: only a new sign-in clears it.
        await this.block('expired');
      } else if (err.kind !== 'rate_limited' && err.kind !== 'unavailable') {
        this.renewRetryAt =
          this.now() +
          TIMINGS.renewRetry[Math.min(this.renewFailures, TIMINGS.renewRetry.length - 1)];
        this.renewFailures += 1;
        this.renewError = err;
        await this.saveMemory();
      } else {
        await this.saveMemory();
      }
      throw err;
    }
    if (epoch !== this.epoch) {
      return;
    }
    this.memory.session = {
      client: this.config.client,
      ...token,
      // Keycloak may answer without a new renewal token: the old one stays.
      refreshToken: token.refreshToken ?? s.refreshToken,
      refreshExpiresAt: token.refreshToken ? token.refreshExpiresAt : s.refreshExpiresAt,
    };
    this.renewFailures = 0;
    this.renewRetryAt = 0;
    this.renewError = undefined;
    await this.saveMemory();
    this.scheduleRenew();
  }

  /** A usable access token: renewed first when it ended (and a renewal is allowed). */
  async accessToken(timeout) {
    const s = this.session;
    if (!s) {
      throw new WeheatError('signed_out', 'not signed in to Weheat');
    }
    if (s.accessToken && this.now() < s.expiresAt - TOKEN_SLACK) {
      return s.accessToken;
    }
    if (this.now() < this.renewRetryAt) {
      throw new WeheatError(
        'renew_wait',
        this.renewError ? errorReason(this.renewError) : 'renewal failed',
      );
    }
    await this.renew(timeout);
    const fresh = this.session;
    if (!fresh?.accessToken) {
      throw new WeheatError('signed_out', 'not signed in to Weheat');
    }
    return fresh.accessToken;
  }

  /**
   * An API call; a 401 renews the token once (when a renewal is allowed) and
   * tries again. Refused again with a token of this cycle: a stop.
   */
  async call(fn, timeout) {
    let token = await this.accessToken(timeout);
    try {
      return await fn(token);
    } catch (err) {
      if (err.kind !== 'unauthorized') {
        throw err;
      }
      if ((this.session?.obtainedAt ?? 0) >= this.cycleStart) {
        throw new WeheatError('unauthorized_block', 'Weheat refused a new access token', {
          status: 401,
        });
      }
      if (this.now() < this.renewRetryAt) {
        throw new WeheatError(
          'renew_wait',
          this.renewError ? errorReason(this.renewError) : 'renewal failed',
        );
      }
      await this.renew(timeout);
      token = this.session?.accessToken;
      if (!token) {
        throw err;
      }
    }
    try {
      return await fn(token);
    } catch (err) {
      if (err.kind === 'unauthorized') {
        throw new WeheatError('unauthorized_block', 'Weheat refused a new access token', {
          status: 401,
        });
      }
      throw err;
    }
  }

  // --- Polling ---------------------------------------------------------------

  /** Read again after the interval, or at the end of a pause. */
  scheduleNext() {
    this.clearTimer();
    if (this.blocked) {
      return;
    }
    const now = this.now();
    const delay = Math.max(this.interval, this.pausedUntil - now, this.renewRetryAt - now);
    const generation = this.generation;
    this.timer = this.timers.setTimeout(
      () => {
        this.timer = undefined;
        if (generation === this.generation) {
          this.tick().catch((err) => this.logger.error(`Weheat refresh failed: ${err.message}`));
        }
      },
      Math.max(0, delay),
    );
  }

  /** One run at a time: a tick during a run joins it. `quick`: for a button. */
  tick({ quick = false } = {}) {
    if (!this.running) {
      this.running = this.run({ quick }).finally(() => {
        this.running = undefined;
      });
    }
    return this.running;
  }

  async run({ quick = false } = {}) {
    const generation = this.generation;
    if (this.blocked) {
      return;
    }
    if (this.now() < this.pausedUntil) {
      this.scheduleNext();
      return;
    }
    const timeout = quick ? TIMINGS.quickTimeout : TIMINGS.requestTimeout;
    this.cycleStart = this.now();
    try {
      await this.readAll(timeout);
      if (generation !== this.generation) {
        return;
      }
      await this.succeeded();
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      await this.failed(err);
    }
    if (generation !== this.generation) {
      return;
    }
    await this.publishDevices();
    this.queueStates();
    await this.flush();
    await this.publishBadges();
    this.scheduleNext();
  }

  /** The list (when due), every log, the energy totals (when due). */
  async readAll(timeout) {
    const options = (token) => ({ token, now: this.now(), timeout });
    if (this.now() - this.listAt >= TIMINGS.listInterval) {
      try {
        const pumps = parsePumps(
          await this.call((token) => listHeatPumps(this.transport, options(token)), timeout),
        );
        if (!pumps) {
          throw new WeheatError('bad_response', 'no list of heat pumps in the answer');
        }
        this.listAt = this.now();
        await this.setPumps(pumps);
      } catch (err) {
        // The heat pumps already known are still read (the list is secondary then).
        if (this.pumps.length === 0 || this.critical(err)) {
          throw err;
        }
        this.logger.warn(`Weheat: the list of heat pumps failed (${errorReason(err)})`);
      }
    }
    let lastError;
    for (const pump of this.pumps) {
      try {
        const log = parseLog(
          await this.call((token) => latestLog(this.transport, pump.id, options(token)), timeout),
        );
        this.logs.set(pump.id, log);
        this.failedPumps.delete(pump.id);
      } catch (err) {
        if (this.critical(err)) {
          throw err;
        }
        lastError = err;
        this.failedPumps.add(pump.id);
        this.logger.warn(`Weheat: the log of a heat pump failed (${errorReason(err)})`);
      }
    }
    if (this.pumps.length > 0 && this.failedPumps.size === this.pumps.length) {
      throw lastError;
    }
    for (const pump of this.pumps) {
      if (this.now() < (this.energyAt.get(pump.id) ?? -Infinity)) {
        continue;
      }
      // Tried again in 30 minutes whatever happens: a failing total never slows the logs.
      this.energyAt.set(pump.id, this.now() + TIMINGS.energyInterval);
      try {
        const energy = parseEnergy(
          await this.call((token) => energyTotal(this.transport, pump.id, options(token)), timeout),
        );
        this.energy.set(pump.id, energy);
      } catch (err) {
        if (this.critical(err)) {
          throw err;
        }
        this.logger.warn(`Weheat: the energy totals failed (${errorReason(err)})`);
      }
    }
  }

  /** Errors that stop the whole cycle: a 429 (the whole account), the session. */
  critical(err) {
    return ['rate_limited', 'unauthorized_block', 'refused', 'signed_out', 'renew_wait'].includes(
      err?.kind,
    );
  }

  /** The heat pumps listed: kept in /data (a failing list later never stops the reads). */
  async setPumps(pumps) {
    const ids = new Set(pumps.map((p) => p.id));
    for (const id of [...this.logs.keys()]) {
      if (!ids.has(id)) {
        this.logs.delete(id);
        this.energy.delete(id);
        this.energyAt.delete(id);
        this.failedPumps.delete(id);
      }
    }
    this.pumps = pumps;
    const stored = { client: this.config.client, list: pumps };
    if (JSON.stringify(stored) !== JSON.stringify(this.memory.pumps)) {
      this.memory.pumps = stored;
      await this.saveMemory();
    }
  }

  async succeeded() {
    this.failures = 0;
    this.offline = false;
    this.connectedOnce = true;
    this.pauseKind = undefined;
    this.pausedUntil = 0;
    if (this.memory.pause) {
      this.memory.pause = null;
      await this.saveMemory();
    }
    let message = this.pumps.length === 0 ? T.noPump : T.connected(this.pumps.length);
    if (this.failedPumps.size > 0) {
      const names = this.pumps.filter((p) => this.failedPumps.has(p.id)).map((p) => p.name);
      message = join(message, T.partial(names));
    }
    await this.setStatus(true, message);
  }

  async failed(err) {
    const reason = errorReason(err);
    switch (err.kind) {
      case 'signed_out':
        if (!this.blocked) {
          this.blocked = 'signed_out';
          await this.setStatus(false, T.signedOut);
        }
        return;
      case 'refused':
        // The renewal was refused: block('expired') already ran.
        return;
      case 'unauthorized_block':
        await this.block('unauthorized');
        return;
      default:
        break;
    }
    let message;
    if (err.kind === 'rate_limited' || err.kind === 'unavailable') {
      const wait = await this.pause(err);
      message = err.kind === 'rate_limited' ? T.rateLimited(age(wait)) : T.unavailable(age(wait));
    } else if (err.kind === 'renew_wait') {
      // The token could not be renewed yet: the reads wait for the renewal.
      const wait = Math.max(this.interval, this.renewRetryAt - this.now());
      this.pauseKind = 'backoff';
      this.pausedUntil = Math.max(this.pausedUntil, this.now() + wait);
      message = T.renewWaiting(reason, age(wait));
    } else {
      // Never read again sooner than the interval.
      const wait = Math.max(
        this.interval,
        TIMINGS.backoff[Math.min(this.failures, TIMINGS.backoff.length - 1)],
      );
      this.pauseKind = 'backoff';
      this.offline = OFFLINE.has(err.kind) || this.offline;
      this.pausedUntil = Math.max(this.pausedUntil, this.now() + wait);
      message = T.unreachable(reason, age(wait));
    }
    this.failures += 1;
    const connected = err.kind === 'rate_limited' && this.connectedOnce;
    await this.setStatus(connected, message);
    this.logger.warn(
      `Weheat: ${reason}; next try in ${Math.round(this.interval / 1000)} s or later`,
    );
  }

  // --- Gladys ----------------------------------------------------------------

  createdDevices() {
    return new Map((this.gladys.devices ?? []).map((d) => [d.external_id, d]));
  }

  createdFeatures() {
    return new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  /**
   * The heat pumps, merged so that nothing ever disappears: a created device
   * keeps its features as Gladys has them (types and units are fixed at
   * creation), plus any new one; a device or a feature seen earlier in this
   * run stays published.
   */
  async publishDevices() {
    const created = this.createdDevices();
    for (const pump of this.pumps) {
      const fresh = buildDevice(this.gladys, pump, this.config.language);
      const previous = this.known.get(fresh.external_id);
      const mine = created.get(fresh.external_id);
      const features = new Map();
      for (const f of mine?.features ?? []) {
        features.set(
          f.external_id,
          Object.fromEntries(
            FEATURE_FIELDS.filter((k) => f[k] !== undefined && f[k] !== null).map((k) => [k, f[k]]),
          ),
        );
      }
      for (const f of [...(previous?.features ?? []), ...fresh.features]) {
        if (!features.has(f.external_id)) {
          features.set(f.external_id, f);
        }
      }
      if (!previous && this.known.size >= LIMITS.pumps) {
        continue;
      }
      this.known.set(fresh.external_id, { ...fresh, features: [...features.values()] });
    }
    const list = [...this.known.values()];
    const json = JSON.stringify(list);
    if (list.length === 0 || json === this.published) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(list);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  queueStates(created = this.createdFeatures()) {
    for (const pump of this.pumps) {
      const states = deviceStates(
        this.gladys,
        pump,
        { log: this.logs.get(pump.id), energy: this.energy.get(pump.id) },
        this.config.language,
      );
      for (const [featureId, value] of states) {
        if (created.has(featureId)) {
          this.publisher.push(featureId, value);
        }
      }
    }
  }

  /** One badge per created device: cloud, or unreachable (stopped, offline, not read, offline for Weheat). */
  async publishBadges() {
    const entries = [];
    const pumps = new Map(this.pumps.map((p) => [deviceIds(this.gladys, p.id).device, p]));
    for (const device of this.gladys.devices ?? []) {
      if (!this.known.has(device.external_id)) {
        continue;
      }
      const pump = pumps.get(device.external_id);
      const unreachable =
        Boolean(this.blocked) ||
        this.offline ||
        !pump ||
        this.failedPumps.has(pump.id) ||
        this.logs.get(pump.id)?.online === false;
      const transport = unreachable ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.CLOUD;
      if (this.badges.get(device.external_id) !== transport) {
        entries.push({ external_id: device.external_id, transport });
      }
    }
    for (let i = 0; i < entries.length; i += 100) {
      const batch = entries.slice(i, i + 100);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.badges.set(entry.external_id, entry.transport);
        }
      } catch (err) {
        this.logger.warn(`Transport badges failed: ${err.message}`);
      }
    }
  }

  async deviceCreated(device) {
    if (device?.external_id) {
      this.badges.delete(device.external_id);
    }
    const created = this.createdFeatures();
    for (const f of device?.features ?? []) {
      created.add(f.external_id);
    }
    this.queueStates(created);
    await this.flush();
    await this.publishBadges();
  }

  async deviceDeleted(device) {
    if (device?.external_id) {
      this.badges.delete(device.external_id);
      this.publisher.forget(device.external_id);
    }
  }

  /** The Discovery tab asks for a scan: the heat pumps known now; the list is read again at the next cycle. */
  async scan() {
    this.listAt = -Infinity;
    this.published = undefined;
    await this.publishDevices();
  }

  // --- Sign-in -----------------------------------------------------------------

  /** The Connect button: the Weheat sign-in address (a new state and PKCE challenge). */
  async oauthAuthorizeUrl(_key, redirectUri) {
    if (!this.config.clientId) {
      throw thrown(T.noClient);
    }
    if (this.hardPaused) {
      throw thrown(this.pauseMessage());
    }
    const redirect = this.config.redirectUri || redirectUri;
    if (!redirect) {
      throw thrown(T.signIn.noRedirect);
    }
    return this.signIns.begin({ clientId: this.config.clientId, redirectUri: redirect });
  }

  /** Weheat redirected to Gladys: the code of a sign-in started here. */
  async oauthCallback(_key, { code, state } = {}) {
    if (typeof code !== 'string' || !code || code.length > LIMITS.codeLength) {
      throw thrown(T.signIn.noCode);
    }
    // Gladys' return carries the state: a missing one never matches a sign-in.
    const signIn = typeof state === 'string' && state ? this.signIns.take(state) : null;
    if (!signIn) {
      throw thrown(T.signIn.unknown);
    }
    const result = await this.exchange(code, signIn);
    if (result !== T.signIn.done) {
      throw thrown(result);
    }
  }

  /** The address pasted by the user (redirect address other than Gladys'). */
  async finishSignIn(fields) {
    const parsed = parseRedirect(fields?.url);
    if (!parsed) {
      return T.signIn.noCode;
    }
    if (parsed.error) {
      const detail = `${parsed.error}${
        parsed.errorDescription
          ? `: ${String(parsed.errorDescription).replace(/\s+/g, ' ').slice(0, 120)}`
          : ''
      }`.slice(0, 160);
      return T.signIn.cancelled(detail);
    }
    const signIn = this.signIns.take(parsed.state);
    if (!signIn) {
      return T.signIn.unknown;
    }
    return this.exchange(parsed.code, signIn);
  }

  /** The code -> a new session, kept in /data; then one read. */
  async exchange(code, signIn) {
    if (!this.config.clientId) {
      return T.noClient;
    }
    if (this.hardPaused) {
      this.signIns.restore(signIn);
      return this.pauseMessage();
    }
    let token;
    try {
      token = await tokenRequest(
        this.transport,
        {
          grant_type: 'authorization_code',
          code,
          redirect_uri: signIn.entry.redirectUri,
          code_verifier: signIn.entry.verifier,
        },
        {
          clientId: this.config.clientId,
          clientSecret: this.config.clientSecret,
          now: this.now(),
          timeout: TIMINGS.quickTimeout,
        },
      );
    } catch (err) {
      this.logger.warn(`Weheat sign-in failed: ${errorReason(err)}`);
      if (err.kind === 'refused') {
        return T.signIn.refused(err.detail ?? 'HTTP 400');
      }
      if (err.kind === 'rate_limited' || err.kind === 'unavailable') {
        await this.pause(err);
        this.signIns.restore(signIn);
        return this.pauseMessage();
      }
      // Weheat was not reached: the same address can be pasted again.
      this.signIns.restore(signIn);
      return T.signIn.failed(errorReason(err));
    }
    if (!token.refreshToken) {
      return T.signIn.refused('no renewal token, scope offline_access');
    }
    // A renewal still running with the previous session must not overwrite this one.
    this.epoch += 1;
    this.memory.session = { client: this.config.client, ...token };
    this.memory.block = null;
    this.blocked = undefined;
    this.failures = 0;
    this.renewFailures = 0;
    this.renewRetryAt = 0;
    this.renewError = undefined;
    if (this.pauseKind === 'backoff') {
      this.pausedUntil = 0;
      this.pauseKind = undefined;
    }
    await this.saveMemory();
    this.logger.info('Weheat: signed in');
    this.scheduleRenew();
    await this.setStatus(false, T.connecting);
    this.tick({ quick: true }).catch((err) =>
      this.logger.error(`Weheat refresh failed: ${err.message}`),
    );
    return T.signIn.done;
  }

  // --- Configuration buttons ----------------------------------------------------

  async testConnection() {
    if (!this.config.clientId) {
      return T.noClient;
    }
    if (this.blocked === 'signed_out' || this.blocked === 'expired') {
      return STOP_MESSAGES[this.blocked];
    }
    const paused = this.pauseMessage();
    if (paused) {
      return paused;
    }
    if (this.now() - this.lastTestAt < TIMINGS.testCooldown) {
      const last = this.lastMessage;
      return last ? join(T.test.cooldown, last) : T.test.cooldown;
    }
    if (this.running) {
      return T.busy;
    }
    this.lastTestAt = this.now();
    // One read per click: the button is how a refused access is tried again.
    if (this.blocked === 'unauthorized') {
      this.blocked = undefined;
      this.memory.block = null;
      await this.saveMemory();
      this.scheduleRenew();
    }
    if (this.pauseKind === 'backoff') {
      this.pausedUntil = 0;
      this.pauseKind = undefined;
    }
    await this.tick({ quick: true });
    return this.lastMessage ?? T.signedOut;
  }
}
