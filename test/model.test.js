// -----------------------------------------------------------------------------
// The port of weheat (heat_pump.py, discovery.py): states, COP, flow, energy.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJson } from '../src/http.js';
import {
  copOf,
  flowOf,
  modelName,
  parseEnergy,
  parseLog,
  parsePumps,
  stateOf,
} from '../src/model.js';
import { PUMP_A, PUMP_B, energyDto, listDto, logDto, pumpDto } from './fixtures/weheat.js';

test('the states of weheat heat_pump_state', () => {
  const cases = [
    [1, 'offline'],
    [40, 'standby'],
    [70, 'heating'],
    [130, 'cooling'],
    [136, 'water_check'],
    [137, 'cooling'],
    [150, 'dhw'],
    [160, 'legionella_prevention'],
    [170, 'self_test'],
    [180, 'manual_control'],
    [1010, 'updating'],
    [90, 'defrosting'],
    [84, 'defrosting'],
    [205, 'defrosting'],
    [240, 'unknown'],
    [999, 'unknown'],
  ];
  for (const [code, state] of cases) {
    assert.equal(stateOf(code), state, String(code));
  }
  assert.equal(stateOf(null), null);
});

test('the COP: 0 without input, the sign turned only while cooling', () => {
  assert.equal(copOf(1000, 4200, 'heating'), 4.2);
  assert.equal(copOf(0, 100, 'standby'), 0);
  assert.equal(copOf(1000, -3000, 'cooling'), 3);
  assert.equal(copOf(1000, 500, 'cooling'), -0.5, 'heat moving the wrong way stays visible');
  assert.equal(copOf(1000, -800, 'defrosting'), -0.8);
  assert.equal(copOf(null, 100, 'heating'), null);
});

test('the flow from the duty cycle of the pump', () => {
  assert.equal(flowOf(0), null);
  assert.equal(flowOf(255), null);
  assert.equal(flowOf(76), null);
  assert.equal(flowOf(2), 0);
  assert.equal(flowOf(5), 0);
  assert.equal(flowOf(75), 2.1);
  assert.equal(flowOf(40), 1.05);
  assert.equal(flowOf(null), null);
});

test('the latest log: values present, -1 room is no reading, wrong types ignored', () => {
  const log = parseLog(logDto(PUMP_A, { tRoom: -1, tAirIn: '7', state: 150 }));
  assert.equal(log.state, 'dhw');
  assert.equal(log.room, null);
  assert.equal(log.outside, null);
  assert.equal(log.water_out, 36.5);
  assert.equal(log.online, true);
  assert.equal(log.at, Date.parse('2026-10-18T09:59:00Z'));
  const empty = parseLog({});
  assert.equal(empty.state, null);
  assert.equal(empty.cop, null);
  assert.equal(parseLog(null).water_in, null);
});

test('the energy totals summed as weheat does', () => {
  assert.deepEqual(parseEnergy(energyDto(PUMP_A)), {
    energy_in: 1265,
    energy_in_indoor: 7,
    energy_out: 4585,
  });
  const partial = parseEnergy(energyDto(PUMP_A, { totalEInDhw: null, totalEOutCooling: 'x' }));
  assert.equal(partial.energy_in, null);
  assert.equal(partial.energy_out, null);
  assert.equal(partial.energy_in_indoor, 7);
});

test('the list: models, tanks, ids checked, duplicates and junk dropped', () => {
  const pumps = parsePumps({
    data: [
      pumpDto(PUMP_A),
      pumpDto(PUMP_A),
      pumpDto(PUMP_B, { name: '  ' }),
      pumpDto('../../etc'),
      pumpDto(PUMP_B.replace('9', '8'), { model: 5 }),
      null,
    ],
  });
  assert.deepEqual(
    pumps.map((p) => [p.name, p.model, p.dhw]),
    [
      ['Blackbird garden', 'Blackbird P60', true],
      ['Sparrow P60', 'Sparrow P60', false],
      ['Sparrow garage', 'Flint P40', false],
    ],
  );
  assert.equal(parsePumps({}), null);
  assert.deepEqual(parsePumps(listDto([])), []);
  assert.equal(modelName(0), 'Blackbird P80');
  assert.equal(modelName(42), 'Weheat');
});

test('JSON answers never reach a prototype', () => {
  const data = parseJson('{"__proto__":{"polluted":1},"data":[{"constructor":{"x":1},"id":"a"}]}');
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf(data), Object.prototype);
  assert.equal(Object.hasOwn(data.data[0], 'constructor'), false);
});
