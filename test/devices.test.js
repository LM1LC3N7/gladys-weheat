// -----------------------------------------------------------------------------
// The Gladys devices: ids, units allowed by the core, read only, states.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { FEATURES, buildDevice, deviceStates, rolesOf } from '../src/devices.js';
import { parseEnergy, parseLog } from '../src/model.js';
import { PUMP_A, energyDto, logDto } from './fixtures/weheat.js';

// DEVICE_FEATURE_UNITS_BY_CATEGORY (and _AND_TYPE for water-valve / flow) of
// server/utils/constants.js in the Gladys core, for the categories used here.
const CORE_UNITS = {
  'temperature-sensor': ['celsius', 'fahrenheit', 'kelvin'],
  'energy-sensor': [
    'milli-ampere',
    'ampere',
    'milli-volt',
    'volt',
    'watt',
    'kilowatt',
    'watt-hour',
    'kilowatt-hour',
    'megawatt-hour',
    'kilovolt-ampere',
    'volt-ampere',
    'volt-ampere-reactive',
    'euro',
    'dollar',
  ],
  'water-valve': ['cubic-meter-per-hour'],
  text: [],
  unknown: [],
};

const pump = {
  id: PUMP_A,
  name: 'Blackbird garden',
  model: 'Blackbird P60',
  serial: 'S',
  dhw: true,
};

test('every unit is one the core lists for its category; never an energy index', () => {
  for (const [key, spec] of Object.entries(FEATURES)) {
    assert.ok(spec.category in CORE_UNITS, `${key}: category ${spec.category}`);
    if (spec.unit) {
      assert.ok(CORE_UNITS[spec.category].includes(spec.unit), `${key}: ${spec.unit}`);
    }
    assert.ok(!['index', 'energy', 'daily-consumption'].includes(spec.type), `${key} is billed`);
    assert.ok(!['binary', 'switch'].includes(spec.type), `${key}: no binary`);
  }
});

test('one device per heat pump, stable ids, read only, tank features with a tank only', () => {
  const gladys = createFakeGladys({});
  const device = buildDevice(gladys, pump, 'fr');
  assert.equal(device.external_id, `ext:test-integration:heatpump:${PUMP_A}`);
  assert.equal(device.should_poll, false);
  assert.deepEqual(device.params, [
    { name: 'model', value: 'Blackbird P60' },
    { name: 'serial_number', value: 'S' },
  ]);
  assert.ok(device.features.every((f) => f.read_only && !f.has_feedback));
  assert.equal(
    device.features.find((f) => f.external_id.endsWith(':outside')).name,
    'Température extérieure',
  );
  assert.ok(rolesOf(pump).includes('dhw_top'));
  assert.ok(!rolesOf({ ...pump, dhw: false }).includes('dhw_top'));
  assert.equal(buildDevice(gladys, pump, 'en').features[0].name, 'State');
});

test('the states: only the values present, the state as text', () => {
  const gladys = createFakeGladys({});
  const log = parseLog(logDto(PUMP_A, { tRoom: -1, state: 999 }));
  const states = new Map(
    deviceStates(gladys, pump, { log, energy: parseEnergy(energyDto(PUMP_A)) }, 'en'),
  );
  const id = (key) => `ext:test-integration:heatpump:${PUMP_A}:${key}`;
  assert.deepEqual(states.get(id('state')), { text: 'Unknown (999)' });
  assert.equal(states.has(id('room')), false, 'no reading, nothing published (never 0)');
  assert.deepEqual(states.get(id('energy_in')), { state: 1265 });
  assert.deepEqual(states.get(id('cop')), { state: 4.2 });
  assert.equal(deviceStates(gladys, pump, {}, 'en').length, 0);
});
