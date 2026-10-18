// -----------------------------------------------------------------------------
// Answers of the Weheat API in the shapes of the weheat models
// (read_all_heat_pump_dto, raw_heatpump_log_and_is_online_dto,
// total_energy_aggregate). Invented values: never checked on a real account.
// -----------------------------------------------------------------------------

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
/** 2026-10-18 10:00 UTC. */
export const NOW = Date.UTC(2026, 9, 18, 10, 0, 0);

export const CLIENT_ID = 'gladys-test-client';
export const CLIENT_SECRET = 'test-client-secret-value';
export const GLADYS_REDIRECT = 'https://gladys.local/dashboard/integration/oauth';

export const PUMP_A = '2f4c1a7e-6b1d-4c39-9d0e-1a2b3c4d5e6f';
export const PUMP_B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

export const pumpDto = (id, overrides = {}) => ({
  id,
  name: id === PUMP_A ? 'Blackbird garden' : 'Sparrow garage',
  model: id === PUMP_A ? 1 : 3,
  dhwType: id === PUMP_A ? 1 : 0,
  boilerType: 0,
  serialNumber: id === PUMP_A ? 'BB60-0001' : 'SP60-0002',
  partNumber: 'PN-1',
  state: 3,
  status: 70,
  controlBoardId: 'cb-1',
  firmwareVersion: '1.2.3',
  ...overrides,
});

export const listDto = (ids) => ({
  data: ids.map((id) => pumpDto(id)),
  metadata: { totalCount: ids.length, pageSize: 1000, currentPage: 1, totalPages: 1 },
});

export const logDto = (id, overrides = {}) => ({
  heatPumpId: id,
  timestamp: '2026-10-18T09:59:00Z',
  state: 70,
  tWaterIn: 31.24,
  tWaterOut: 36.5,
  tWaterHouseIn: 30.9,
  tAirIn: 7.25,
  tAirOut: 3.1,
  tRoom: 20.4,
  tRoomTarget: 21,
  tThermostatSetpoint: 37,
  t1: 51.2,
  t2: 44.8,
  rpm: 3200,
  centralHeatingFlow: 40,
  dhwFlow: 2,
  dhwTargetTemperature: 50,
  cmMassPowerIn: 1000,
  cmMassPowerOut: 4200,
  isOnline: true,
  ...overrides,
});

export const energyDto = (id, overrides = {}) => ({
  heatPumpId: id,
  totalEInHeating: 1000,
  totalEInStandby: 20,
  totalEInDhw: 200,
  totalEInHeatingDefrost: 30,
  totalEInDhwDefrost: 5,
  totalEInCooling: 10,
  totalEOutHeating: 4000,
  totalEOutDhw: 600,
  totalEOutHeatingDefrost: -40,
  totalEOutDhwDefrost: -5,
  totalEOutCooling: -30,
  totalEInIUStandby: 1,
  totalEInIUHeating: 2,
  totalEInIUDhw: 3,
  totalEInIUHeatingDefrost: 0.5,
  totalEInIUDhwDefrost: 0.25,
  totalEInIUCooling: 0.25,
  ...overrides,
});
