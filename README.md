# gladys-weheat

[Gladys Assistant](https://gladysassistant.com) external integration for
**Weheat** heat pumps (Blackbird, Sparrow, Flint), through the official Weheat
third-party API, read only: state, water, outside, room and hot water tank
temperatures, COP, electrical and heat output power, energy totals and water
flow. **Never tested with a real account. Not affiliated with Weheat.**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (WeheatApp)
                                  ├─ src/oauth.js      PKCE, pending sign-ins, pasted address, token endpoint
                                  ├─ src/api.js        list, latest log, energy totals
                                  ├─ src/http.js       the only HTTPS access, errors, bounds, JSON
                                  ├─ src/model.js      answers -> values (port of weheat, pure)
                                  ├─ src/devices.js    heat pump -> Gladys device and states (pure)
                                  ├─ src/publisher.js  states within 300/min
                                  └─ src/store.js      /data/weheat-state.json (0600)
```

- **Sign-in** (as the Home Assistant integration): OAuth2 authorization code
  with PKCE S256 on the Keycloak realm `Weheat` of `auth.weheat.nl`, scopes
  `openid offline_access`, with the client id and secret Weheat gives. The
  Connect button of the `oauth2` field returns to Gladys (`onOAuthCallback`,
  state checked, one use, 15 minutes); with another redirect address
  registered for the client, the user pastes the address the browser ended on
  into the _Finish the sign-in_ action. The password is typed on the Weheat
  page only. Nothing signs in without a click.
- **Tokens**: kept in `/data/weheat-state.json` (mode 0600) with the client
  they belong to (hash of the client id); renewed by a timer at the end minus
  min(5 min, half the lifetime), never twice within a minute, never during a
  pause. A refused renewal (`invalid_grant`) is the persisted "session ended"
  stop; an API 401 renews once and retries once, refused again with a fresh
  token it is the persisted "access refused" stop (lifted by Connect or the
  test button).
- **Reads**: `GET /api/v1/heat-pumps?page=1&pageSize=1000&State=3` (every 6 h
  and on a scan, kept in `/data`), `GET /api/v1/heat-pumps/<id>/logs/latest`
  every 2 minutes per heat pump at least, `GET /api/v1/energy-logs/<id>/total`
  every 30 minutes, on `api.weheat.nl/third_party`. Answers read up to 1 MiB.
- **Errors**: 429 pauses every path (`Retry-After` bounded to 1 min – 6 h,
  15 min without it), 5xx on every heat pump pauses 5 min – 1 h; both kept in
  `/data`, capped when read back, kept across a reconnection. Network and
  other errors: never sooner than the interval, then 5, 15, 30 min. The list
  (with known heat pumps), the energy totals and one heat pump failing never
  stop the others.
- **Gladys side**: one device per heat pump (`heatpump:<uuid>`), all features
  read only: `temperature-sensor` (°C), `energy-sensor/power` (W, electrical),
  `water-valve/flow` (m³/h), `text` (state), and plain sensors
  (`unknown/decimal`) for the COP, the heat output power and the energy
  totals, never an energy index. The Discovery list never shrinks; status and
  Discovery are sent again at every reconnection to Gladys.

## Credits

The API paths, the fields, the states, the COP, the flow and the energy sums
are ported from [weheat](https://github.com/wefabricate/wh-python) (Weheat
B.V., MIT), the manufacturer's Python client; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The OAuth flow and the
polling pace follow the Weheat integration of
[Home Assistant](https://github.com/home-assistant/core/tree/dev/homeassistant/components/weheat)
(Apache-2.0), read, no code taken. Modelled on the sibling integrations
[gladys-hubspace](https://github.com/LM1LC3N7/gladys-hubspace) and
[gladys-bosch-indego](https://github.com/LM1LC3N7/gladys-bosch-indego).

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit                                   # npm audit --omit=dev
npx github:GladysAssistant/integration-store .  # store admission checks
```

Tests never touch the network: Weheat is a fake behind the injected transport
(token endpoint with PKCE checks, list, logs, energy totals), Gladys is the
SDK's fake.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0 (`LICENSE`). The ported logic comes from an MIT project, credited
with its notice in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (also
shipped in the Docker image).
