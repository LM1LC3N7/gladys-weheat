# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Weheat heat pumps (Blackbird, Sparrow, Flint) through the official Weheat
  API, read only: one device per heat pump with its state, water, outside,
  room and hot water tank temperatures, COP, electrical and heat output power,
  energy totals (plain sensors) and water flow.
- OAuth2 sign-in with PKCE, with the client ID and secret given by Weheat:
  the Connect button returns to Gladys, or the address the browser ended on
  is pasted into "Finish the sign-in". The password is typed on the Weheat
  page only.
- The tokens are kept in `/data` (mode 0600) and renewed by a timer before
  their end; a refused renewal or access is a stop kept across restarts,
  lifted only by a click.
- Polite polling: 2 minutes per heat pump at least, energy totals every 30
  minutes, the list every 6 hours; 429 and 5xx pauses kept in `/data`; a
  failing heat pump, list or energy total never stops the others.
- Transport badges, English and French texts, documentation, cover image.
- Never tested with a real account yet.

[Unreleased]: https://github.com/LM1LC3N7/gladys-weheat/commits/main
