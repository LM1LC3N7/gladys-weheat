# TODO — Weheat v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm run audit`, `npx github:GladysAssistant/integration-store .`,
  then update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- No forum topic of its own, no forum post from a module session: the batch
  reserved in /t/10385 (post #275, lot 8, wave 1) gets one recap message there.
- The `gladys-assistant-integration` topic is added at the first real release only.

## Status

- [x] **Milestone 1 — core** (2026-10-18): OAuth2 with PKCE (Connect button
      returning to Gladys, or a pasted address), tokens in `/data` renewed by
      a timer, list / latest log / energy totals ported from weheat 2026.9.3,
      one read-only device per heat pump, persisted stops and pauses, badges,
      docs en/fr, cover. Tested against made-up answers only (Node 22 and
      24). The store validator cannot run from the development sandbox: it
      runs at publication. No Docker on this PC: the image was not built here
      (the CI builds it).
- [ ] **Milestone 2 — real account**: run against a real account (see "To
      check on a real account"), turn the answers (anonymized) into
      fixtures, fix what differs.
- [ ] **Milestone 3 — energy index**: once a real account shows the
      electricity totals only go up, an opt-in `energy-sensor/index` for the
      electricity of the outdoor and indoor units, with the guard of
      gladys-youless (never 0, never lower, a jump up held until the user
      accepts it). Heat produced stays a plain sensor (not electricity).
- [ ] **Later**: the cooling diagnostics of Home Assistant (cooling state,
      blocking condition, wait until), the compressor speed, the setpoints
      (water, room, hot water) as read-only sensors, a "heat pump online"
      read-only state.

## To check on a real account

- The client: how a Gladys user gets a client ID and secret from Weheat,
  which redirect addresses Weheat registers, whether PKCE is required with a
  confidential client (sent either way), whether the secret is expected in
  the form (`client_secret_post`, sent) or in Basic auth.
- The token answer: `expires_in`, `refresh_expires_in` (0 for an offline
  token), the rotation of the refresh token (handled either way).
- The list: `State=3` returns the active heat pumps of the user (Home
  Assistant's call), its size, `dhwType` values.
- The latest log: field names and units (`cmMassPowerIn` / `Out` in W,
  temperatures in °C, `tRoom` of -1 without thermostat), how old the log may
  be when the heat pump is offline, `isOnline`.
- The energy totals: kWh, do they only go up, are they delayed (hourly
  buckets?).
- Rate limits: none documented; Home Assistant reads every 120 s per heat
  pump and the energy every 30 min. Watch for 429 and `Retry-After`.

## Decisions

- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json`, the
  manifest and the `docker_image` tag (`ghcr.io/lm1lc3n7/gladys-weheat:0.1.0`);
  the first patch release gives 0.1.1. `test/manifest.test.js` checks the
  four agree.
- **Licenses**: weheat is MIT (Weheat B.V., 2024), checked on tag 2026.9.3
  before use; its logic is ported (full MIT notice in
  `THIRD_PARTY_NOTICES.md`, shipped in the image). The Home Assistant
  integration (Apache-2.0) was only read. `LICENSE`: the standard Apache-2.0
  text, no name.
- **OAuth like Home Assistant**: authorization code with PKCE S256, scopes
  `openid offline_access`, endpoints of `const.py`. The client ID and secret
  come from Weheat (Home Assistant asks for them as application
  credentials); they are configuration fields (`client_secret` is a
  `secret` field: kept by Gladys in its database, never shown again, sent
  only to Weheat; never in `/data`). No password field: the password is typed
  on the Weheat page, never seen by the integration. Weheat's README shows a
  password grant: not used (it would need the password in Gladys).
- **Two ways back**: the `oauth2` field (Connect) gives Gladys' own redirect
  address and Gladys relays the code to `onOAuthCallback` (state required and
  checked). When Weheat registered another address for the client, the
  optional `redirect_uri` field replaces Gladys' address in the
  authorization request, and the user pastes the address the browser ended
  on into the `finish_sign_in` action (indego's model). A pending sign-in
  (state, verifier, redirect) lives in memory only, 15 minutes, one use, 5
  at most; a restart needs a new click.
- **Tokens in /data** (the brief): `/data/weheat-state.json`, mode 0600,
  written whole (temporary file, fsync, rename), with the client key (sha256
  of the client id, 16 hex digits); a new client id ignores the old session.
- **Renewal by timer**: at `expiresAt - min(5 min, lifetime / 2)`, floored at
  the last renewal + 1 minute (kept in `/data`, a future value read back as
  now) and at the end of a 429/5xx pause or of a failed renewal (1, 5, 15,
  60 min). A read with an ended token renews first under the same floor.
  `invalid_grant` (400/401 of the token endpoint) = `expired` stop: session
  dropped, stop kept in `/data`, only a new sign-in lifts it. A 403 of the
  token host is transient, not a refusal.
- **401 of the API**: one renewal and one retry in the same cycle; a 401
  with a token obtained in this cycle is the `unauthorized` stop (kept in
  `/data`), lifted by a new sign-in or the test button (one read per click).
- **Pauses** (lot 6 lesson): 429 everywhere (reads, renewals, sign-in,
  buttons), `Retry-After` bounded to 1 min – 6 h, 15 min without it; 5xx on
  every heat pump (or on the list with none known, or on the token endpoint)
  5, 15, 30, 60 min and never under the interval. Both kept in `/data`,
  capped when read back, kept across a reconnection to Gladys. Other errors:
  the interval, then 5, 15, 30 min, never sooner than the interval.
- **Secondary endpoints never block**: the list (when heat pumps are known,
  from this run or `/data`), the energy totals (tried again 30 min later
  whatever happens) and one heat pump (status says which) fail alone; only a
  429 or a session problem stops the cycle.
- **Pace**: Home Assistant's 120 s per heat pump (configurable 2–60 min,
  never under 2 min × heat pumps), energy every 30 min, list every 6 h and on
  a Discovery scan (at the next cycle, no extra request at once).
- **Features** (units of the core's `DEVICE_FEATURE_UNITS_BY_CATEGORY`, fixed
  at creation): temperatures `temperature-sensor/decimal` °C; electrical
  power `energy-sensor/power` W (instantaneous, never billed); flows
  `water-valve/flow` m³/h (the only flow type of the core; read only, no
  binary); state `text/text` (translated, the code shown when unknown); COP,
  heat output power and energy totals plain sensors `unknown/decimal` with
  the unit in the name. Hot water tank features only when `dhwType` is 1.
  No `switch`/`binary` anywhere.
- **Energy as plain sensors** (wave 2 and lot 6 lessons): the core bills
  every rise of an `energy-sensor` index as electricity. Heat produced is not
  electricity (and goes down while cooling or defrosting); the electricity
  totals are a server sum never seen on a real account, so they are not
  "cumulative and reliable" yet. Milestone 3 may add an opt-in index.
- **Values**: weheat's computations kept as is: COP = out / in, 0 without
  input, sign turned only while cooling; flow from the pump duty cycle
  (1–75, 2.1 m³/h max, ≤ 5 = 0); `tRoom` of -1 = no reading (nothing
  published, never 0). A value absent from the answer is never published.
- **Badges**: unreachable when stopped, when the last cycle failed on the
  network or a 5xx, when the heat pump was not read, or when Weheat says
  `isOnline: false`.
- **Publication never shrinks** (lot 6 lesson): a created device is
  published with its features as Gladys has them, plus new ones; a device or
  feature seen earlier in the run stays. Status, Discovery and badges are
  sent again at every `connected`; a reconnection keeps tokens, stops and
  pauses.
- **Hostile answers**: bodies read up to 1 MiB, JSON parsed without
  `__proto__` / `constructor` / `prototype` keys, only named fields read,
  heat pump ids checked (`[A-Za-z0-9-]{1,64}`) before they go into a path or
  an external id, at most 20 heat pumps.
- **Categories `climate` and `energy`** in the store.
- **Not checked here (PIPELINE step 1, main session)**: duplicates in the
  store, the core and the forum were checked when the batch was reserved
  (post #275).
