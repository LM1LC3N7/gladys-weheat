# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15), its only
runtime dependency (HTTPS goes through `node:https`). It reads Weheat heat
pumps (Blackbird, Sparrow, Flint) through the official Weheat third-party API,
read only, after an OAuth2 sign-in with PKCE (client id and secret given by
Weheat). Ported from weheat (MIT, the manufacturer's Python client). Never
tested with a real account, not affiliated with Weheat.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` (Node 22 and 24) and `audit` before every
commit.

## Architecture

```
index.js            SDK bootstrap only
src/handlers.js     every SDK handler -> the app (shared with the tests)
src/app.js          WeheatApp: sign-in, renewal timer, cycle and its timer, pauses,
                    stops, devices, states, badges, buttons
src/oauth.js        PKCE, pending sign-ins, pasted address, token endpoint (pure + 1 call)
src/api.js          the 3 API calls (list, latest log, energy totals)
src/http.js         the only network access (node:https, bounded), errors, JSON
src/model.js        API answers -> values: states, COP, flow, energy (pure, port of weheat)
src/devices.js      heat pump -> Gladys device and states (pure)
src/publisher.js    states within 300/min
src/store.js        /data/weheat-state.json (0600): tokens, stop, pause, heat pumps
src/config.js       config_schema normalized, client key (hash of the client id)
src/constants.js    hosts, paths, manifest keys, limits, timings
src/i18n.js         runtime texts, feature and state names (en/fr)
test/fixtures/      answers shaped like the weheat models
test/helpers/       a fake Weheat behind the transport; Gladys is the SDK's fake
```

## Rules

- **External ids are forever**: device `heatpump:<uuid>`, features by role
  (see the header of `src/devices.js`). Never change how they are built.
- Manifest keys (`client_id`, `client_secret`, `redirect_uri`, `account`,
  `poll_minutes`, `language`, the actions `finish_sign_in` (`url`) and
  `test_connection`) are frozen.
- **Sign-in only on a click** (Connect, Finish the sign-in): never from a
  start, a `connected`, a cycle or a retry. No password ever reaches this
  code. A refused renewal is the `expired` stop, an access refused with a
  fresh token the `unauthorized` stop: both persisted, never retried by
  themselves. Never log or put in a message a token, a code, a verifier or
  the client secret.
- **Token renewal by a timer**: at the end minus min(5 min, half the
  lifetime), never twice within a minute, never during a pause.
- Polling politely: 2 minutes per heat pump at least, energy every 30 min,
  never sooner than the interval after an error; 429 and 5xx pauses are kept
  in /data and hold for every path. A secondary endpoint (list with known
  heat pumps, energy, one heat pump) failing never stops the others.
- Read only: no command. Energy totals stay plain sensors (never an
  `energy-sensor` index) until checked on a real account.
- The Discovery list never shrinks; status and Discovery are sent again at
  every `connected`; a reconnection keeps tokens, stops and pauses.
- Units only from the core's `DEVICE_FEATURE_UNITS_BY_CATEGORY`; a `secret`
  field is kept by Gladys in its database, never write that it is encrypted.
- Files are UTF-8 without BOM (`test/encoding.test.js`); tests never touch
  the network nor the system temp directory.
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow (0.1.0 was set by
  hand once, see TODO.md).
