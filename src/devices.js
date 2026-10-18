// -----------------------------------------------------------------------------
// Weheat heat pumps -> Gladys devices, and their states (pure).
//
// One Gladys device per heat pump, `ext:<selector>:heatpump:<uuid>`, the uuid
// being the id Weheat gives the heat pump (stable, unique). The features are
// keyed by their role (the last part of their external id), all read only.
// Units are the ones the core lists for each category, fixed at creation:
// - temperatures: `temperature-sensor` / `decimal`, °C;
// - electrical power: `energy-sensor` / `power`, W (never billed);
// - the flow: `water-valve` / `flow`, m³/h (the only flow type of the core);
// - the state: `text` / `text`;
// - COP, heat output power and the energy totals: plain sensors
//   (`unknown` / `decimal`, the unit in the name). The totals are never an
//   `energy-sensor` index: the core would bill every rise of it as
//   electricity, and heat is not electricity; the electricity totals are a
//   server sum never checked on a real account (see TODO.md).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as TY,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { FEATURE_NAMES, stateText, word } from './i18n.js';

const temperature = (min, max) => ({
  category: C.TEMPERATURE_SENSOR,
  type: TY.SENSOR.DECIMAL,
  unit: U.CELSIUS,
  min,
  max,
});
const plain = (min, max) => ({ category: C.UNKNOWN, type: TY.SENSOR.DECIMAL, min, max });

/** The features, by role; `source`: the log or the energy totals. */
export const FEATURES = {
  state: { category: C.TEXT, type: TY.TEXT.TEXT, min: 0, max: 0, keepHistory: false },
  water_in: temperature(-30, 100),
  water_out: temperature(-30, 100),
  water_house_in: temperature(-30, 100),
  outside: temperature(-50, 60),
  room: temperature(-20, 50),
  dhw_top: { ...temperature(-30, 100), dhw: true },
  dhw_bottom: { ...temperature(-30, 100), dhw: true },
  power_in: {
    category: C.ENERGY_SENSOR,
    type: TY.ENERGY_SENSOR.POWER,
    unit: U.WATT,
    min: 0,
    max: 20_000,
  },
  power_out: plain(-30_000, 30_000),
  cop: plain(-20, 20),
  flow: {
    category: C.WATER_VALVE,
    type: TY.WATER_VALVE.FLOW,
    unit: U.CUBIC_METER_PER_HOUR,
    min: 0,
    max: 5,
  },
  dhw_flow: {
    category: C.WATER_VALVE,
    type: TY.WATER_VALVE.FLOW,
    unit: U.CUBIC_METER_PER_HOUR,
    min: 0,
    max: 5,
    dhw: true,
  },
  energy_in: { ...plain(0, 10_000_000), energy: true },
  energy_in_indoor: { ...plain(0, 10_000_000), energy: true },
  energy_out: { ...plain(-10_000_000, 10_000_000), energy: true },
};

/** The roles of a heat pump: the hot water ones only with a tank. */
export const rolesOf = (pump) =>
  Object.entries(FEATURES)
    .filter(([, spec]) => !spec.dhw || pump.dhw)
    .map(([key]) => key);

export const deviceIds = (gladys, pumpId) => gladys.externalIds('heatpump', pumpId);

/** The Gladys device of a heat pump, its names in `language`. */
export function buildDevice(gladys, pump, language) {
  const ids = deviceIds(gladys, pump.id);
  const params = [
    ['model', pump.model],
    ['serial_number', pump.serial],
  ]
    .filter(([, v]) => typeof v === 'string' && v !== '')
    .map(([name, value]) => ({ name, value: value.slice(0, 100) }));
  return {
    name: pump.name.slice(0, 100),
    external_id: ids.device,
    should_poll: false,
    params,
    features: rolesOf(pump).map((key) => {
      const spec = FEATURES[key];
      return {
        name: word(FEATURE_NAMES[key], language).slice(0, 100),
        external_id: ids.feature(key),
        category: spec.category,
        type: spec.type,
        ...(spec.unit ? { unit: spec.unit } : {}),
        min: spec.min,
        max: spec.max,
        read_only: true,
        has_feedback: false,
        keep_history: spec.keepHistory ?? true,
      };
    }),
  };
}

/**
 * The current states of a heat pump: `[[featureId, { state } | { text }]]`,
 * only for the values present (an absent value is never published as 0).
 */
export function deviceStates(gladys, pump, { log, energy } = {}, language = 'en') {
  const ids = deviceIds(gladys, pump.id);
  const states = [];
  for (const key of rolesOf(pump)) {
    const spec = FEATURES[key];
    if (key === 'state') {
      if (log?.state) {
        states.push([ids.feature(key), { text: stateText(log.state, log.stateCode, language) }]);
      }
      continue;
    }
    const value = spec.energy ? energy?.[key] : log?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      states.push([ids.feature(key), { state: value }]);
    }
  }
  return states;
}
