// -----------------------------------------------------------------------------
// Weheat answers -> plain values (pure). Ported from weheat
// (abstractions/heat_pump.py and abstractions/discovery.py, MIT): the state
// codes, the coefficient of performance, the flow computed from the pump
// duty cycle, the energy totals. Only the fields named here are read: the
// answers never become objects of this code.
// -----------------------------------------------------------------------------

import { LIMITS } from './constants.js';

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const round = (value, digits = 2) =>
  value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits;
const text = (value, max = 100) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : null;

/** HeatPumpModel -> the name weheat gives it (discovery.py); an unknown model keeps "Weheat". */
export function modelName(model) {
  switch (model) {
    case 0:
      return 'Blackbird P80';
    case 1:
      return 'Blackbird P60';
    case 2:
    case 3:
    case 4:
      return 'Sparrow P60';
    case 5:
      return 'Flint P40';
    default:
      return 'Weheat';
  }
}

/** A heat pump id as the API gives it (a UUID): safe in a path and an external id. */
const pumpId = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(value) ? value.toLowerCase() : null;

/** The paged list of heat pumps -> [{ id, name, model, serial, dhw }] (at most LIMITS.pumps). */
export function parsePumps(data) {
  const list = Array.isArray(data?.data) ? data.data : null;
  if (!list) {
    return null;
  }
  const pumps = [];
  const seen = new Set();
  for (const pump of list) {
    const id = pumpId(pump?.id);
    if (!id || seen.has(id) || pumps.length >= LIMITS.pumps) {
      continue;
    }
    seen.add(id);
    const model = modelName(pump.model);
    pumps.push({
      id,
      name: text(pump.name) ?? model,
      model,
      serial: text(pump.serialNumber, 64),
      // discovery.py: a DHW vessel when dhwType is 1.
      dhw: pump.dhwType === 1,
    });
  }
  return pumps;
}

/** heat_pump_state of weheat: the numeric state -> a key. */
export function stateOf(code) {
  if (code === null) {
    return null;
  }
  if (code === 1) return 'offline';
  if (code === 40) return 'standby';
  if (code === 70) return 'heating';
  if (code === 136) return 'water_check';
  if (code >= 130 && code <= 137) return 'cooling';
  if (code === 150) return 'dhw';
  if (code === 160) return 'legionella_prevention';
  if (code === 170) return 'self_test';
  if (code === 180) return 'manual_control';
  if (code === 1010) return 'updating';
  if ([84, 90, 100, 110, 120].includes(code) || (code >= 200 && code < 240)) {
    return 'defrosting';
  }
  return 'unknown';
}

/**
 * The coefficient of performance of one log (weheat `cop`): output / input,
 * 0 while no power goes in, the sign turned only while cooling.
 */
export function copOf(powerIn, powerOut, state) {
  if (powerIn === null || powerOut === null) {
    return null;
  }
  if (powerIn <= 0) {
    return 0;
  }
  return round(((state === 'cooling' ? -1 : 1) * powerOut) / powerIn);
}

/** weheat `_pwm_to_volume`: duty cycle of the pump -> m³/h (max 2.1 m³/h). */
export function flowOf(pwm, max = 2.1) {
  if (pwm === null) {
    return null;
  }
  // 0 or above 75: abnormal (255 = off).
  if (pwm < 1 || pwm > 75) {
    return null;
  }
  if (pwm <= 5) {
    return 0;
  }
  return round(((pwm - 5) / 70) * max, 3);
}

/** The latest log -> the values published (null when absent). */
export function parseLog(data) {
  const code = num(data?.state);
  const state = stateOf(code);
  const powerIn = num(data?.cmMassPowerIn);
  const powerOut = num(data?.cmMassPowerOut);
  // tRoom of -1: no OpenTherm thermostat reading (weheat `_if_available_and_valid`).
  const room = num(data?.tRoom);
  const at = Date.parse(typeof data?.timestamp === 'string' ? data.timestamp : '');
  return {
    at: Number.isNaN(at) ? null : at,
    online: typeof data?.isOnline === 'boolean' ? data.isOnline : null,
    stateCode: code,
    state,
    water_in: round(num(data?.tWaterIn)),
    water_out: round(num(data?.tWaterOut)),
    water_house_in: round(num(data?.tWaterHouseIn)),
    outside: round(num(data?.tAirIn)),
    room: room === -1 ? null : round(room),
    dhw_top: round(num(data?.t1)),
    dhw_bottom: round(num(data?.t2)),
    power_in: round(powerIn, 0),
    power_out: round(powerOut, 0),
    cop: copOf(powerIn, powerOut, state),
    flow: flowOf(num(data?.centralHeatingFlow)),
    dhw_flow: flowOf(num(data?.dhwFlow)),
  };
}

const sum = (data, keys) => {
  let total = 0;
  for (const key of keys) {
    const value = num(data?.[key]);
    if (value === null) {
      return null;
    }
    total += value;
  }
  return total;
};

/**
 * The energy totals (kWh since the heat pump started reporting), as weheat
 * sums them: electricity of the outdoor unit (`energy_total`), of the indoor
 * unit (`energy_in_indoor_unit`), and the useful heat (`energy_output`, which
 * counts cooling and defrosting against it, so it can go down).
 */
export function parseEnergy(data) {
  const outdoor = sum(data, [
    'totalEInHeating',
    'totalEInDhw',
    'totalEInCooling',
    'totalEInStandby',
    'totalEInHeatingDefrost',
    'totalEInDhwDefrost',
  ]);
  const indoor = sum(data, [
    'totalEInIUHeating',
    'totalEInIUDhw',
    'totalEInIUCooling',
    'totalEInIUStandby',
    'totalEInIUHeatingDefrost',
    'totalEInIUDhwDefrost',
  ]);
  const gained = sum(data, [
    'totalEOutHeating',
    'totalEOutDhw',
    'totalEOutHeatingDefrost',
    'totalEOutDhwDefrost',
  ]);
  const cooling = num(data?.totalEOutCooling);
  return {
    energy_in: round(outdoor, 3),
    energy_in_indoor: round(indoor, 3),
    energy_out: gained === null || cooling === null ? null : round(gained - cooling, 3),
  };
}
