# Weheat for Gladys Assistant

This integration reads your **Weheat** heat pumps (Blackbird, Sparrow, Flint)
through the official Weheat API, **read only**: nothing is ever commanded.

> Unofficial connector, **not affiliated with Weheat**. **Never tested with a
> real account** or heat pump yet: it follows the manufacturer's official
> library (`weheat`, MIT) and the Weheat integration of Home Assistant. Your
> feedback is welcome on the Gladys forum. Weheat, Blackbird, Sparrow and
> Flint are trademarks of their owner.

## What you get

One device per active heat pump of the account, with:

| Feature                                                    | Unit         | Note                                              |
| ---------------------------------------------------------- | ------------ | ------------------------------------------------- |
| State                                                      | text         | heating, hot water, standby, defrosting, cooling… |
| Water in (return), water out (flow), heating water in      | °C           |                                                   |
| Outside temperature                                        | °C           | measured at the air inlet of the heat pump        |
| Room temperature (thermostat)                              | °C           | only with an OpenTherm thermostat                 |
| Hot water tank, top and bottom                             | °C           | only with a tank                                  |
| Electrical power                                           | W            |                                                   |
| Heat output power (W)                                      | plain sensor | negative while cooling or defrosting              |
| COP (coefficient of performance)                           | plain sensor | from the latest log, as Weheat computes it        |
| Heating water flow, hot water flow                         | m³/h         | estimated from the pump control                   |
| Electricity used, outdoor unit and indoor unit (kWh total) | plain sensor | totals since commissioning                        |
| Heat produced (kWh total)                                  | plain sensor | can go down (cooling, defrosting)                 |

The energy totals are **plain sensors**, not energy indexes: Gladys does not
count them in its consumption tracking nor prices them. Heat is not
electricity, and the electricity total is a sum computed by the Weheat server
that we could not check on a real account. An electricity index may come once
a user confirms it only goes up.

The badge of each device turns "unreachable" when Weheat reports the heat
pump offline, when it could not be read, or when the integration is stopped.

## Before you start: the client ID

The Weheat API needs a **client ID** (and a **client secret**) given by
Weheat, as for the Home Assistant integration (whose documentation points to
the knowledge base of Weheat support; otherwise, ask Weheat support for
them). Weheat also registers a **redirect address** for that client: where
the browser goes back to after the sign-in. Use a client Weheat gives you,
under its terms of use.

- If Weheat registered the address of your Gladys, signing in takes one
  click.
- Otherwise (for example a client meant for another application), the sign-in
  ends with a copy and paste of an address (see below).

## Signing in

1. In **Integrations → Weheat → Configuration**, enter the **client ID** and
   the **client secret**, then save.
2. Click **Connect**: the Weheat sign-in page opens. Sign in with the e-mail
   and the password of your Weheat account. **Your password is typed on the
   Weheat page only**: the integration never sees it.
3. Weheat sends you back to Gladys: the integration reads your heat pumps.
   Add them from the **Discovery** tab.

### With another redirect address

1. Enter the address Weheat registered in **Redirect address** (https, or
   http on localhost only) and save.
2. Click **Connect** and sign in on the Weheat page.
3. At the end, the browser stops on that address (the page may show an error,
   that is expected). Copy **the whole address** from the address bar: it
   holds `code=` and `state=`.
4. Paste it into the **Finish the sign-in** action, within 15 minutes. It
   must hold `state=` and start with the redirect address: another address is
   refused (the sign-in then stays usable).

A sign-in serves once; after a restart of the integration, click Connect
again. If Weheat is slow to answer (over 3.5 seconds on the return to Gladys,
10 seconds for "Finish the sign-in"), the integration says "Weheat is slow to
answer: click Connect again": start the sign-in again.

## What the integration keeps

- The **client secret** is kept by Gladys in its database, like every
  configuration value: never shown again, sent only to Weheat.
- The Weheat **tokens** (access and renewal) are kept in clear in the file
  `/data/weheat-state.json` of the integration's volume, readable by its
  container only (mode 0600), and sent only to Weheat. The same file keeps
  the pauses, the stops and the list of heat pumps. No password is ever
  written there.

## Refresh pace

- The latest log of each heat pump is read every **2 minutes** by default,
  and at least 2 minutes per heat pump (as Home Assistant): 4 minutes with
  two heat pumps.
- The energy totals are read every 30 minutes, the list of heat pumps every
  6 hours (and on request from Discovery).
- The token is renewed by a timer shortly before its end, never twice within
  a minute.
- After a restart, the first read waits for the end of the interval since the
  last read and for the end of a running pause (both kept in /data).

## Errors and stops

| Situation                                            | What the integration does                                                               |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Weheat asks to slow down (HTTP 429)                  | pause of 1 minute to 6 hours (as Weheat says), kept across a restart, for every request |
| Weheat unavailable (5xx error)                       | pause of 5 minutes to 1 hour, kept across a restart                                     |
| Network down, unexpected answer                      | new try after the interval, then 5, 15, 30 minutes, kept across a restart               |
| One heat pump, the energy totals or the list failing | the rest goes on; new try at the next round (30 minutes for the energy and the list)    |
| Renewal refused by Weheat                            | "session ended" stop, kept: click Connect                                               |
| Access refused even with a new token                 | stop kept: check the account, then Connect or "Test Weheat"                             |

The integration never signs in by itself and never retries a refusal: only a
click does. The **Test Weheat** button reads the heat pumps at once (at most
once every 30 seconds).

## Troubleshooting

- **"Enter the client ID"**: the client ID is missing.
- **Weheat refused the sign-in (`invalid_client`)**: wrong client ID or
  secret.
- **Weheat refused the sign-in (`invalid_grant`)** or a redirect error on the
  Weheat page: the redirect address does not match the one registered for
  this client, or the pasted address is older than 15 minutes.
- **No heat pump**: only the heat pumps "active" at Weheat are read.

## Limits

- Read only: no setpoint, no mode.
- The values come from the Weheat cloud (latest known log), not from the heat
  pump locally.
- Never tested with a real account: the field names and computations follow
  the `weheat` library 2026.9.3.
