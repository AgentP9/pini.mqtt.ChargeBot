const assert = require('node:assert/strict');
const { recoverChargerStates, recoverApplianceStates, relayAction } = require('../backend/mqttRecovery');
const chargers = [{ id: 'a', name: 'A', topic: 'shelly/a' }, { id: 'b', name: 'B', topic: 'shelly/b' }];
const sessions = [
  { id: 11, chargerId: 'a', startTime: '2026-01-01T10:00:00Z', endTime: null },
  { id: 12, chargerId: 'a', startTime: '2026-01-01T11:00:00Z', endTime: null },
  { id: 13, chargerId: 'b', startTime: '2026-01-01T11:00:00Z', endTime: '2026-01-01T11:30:00Z' }
];
const recovered = recoverChargerStates(chargers, sessions);
assert.equal(recovered.a.currentProcessId, 12);
assert.equal(recovered.a.relayConfirmed, false);
assert.equal(recovered.b.currentProcessId, null);
assert.equal(relayAction(recovered.a, true), 'resume');
assert.equal(relayAction(recovered.a, false), 'end');
assert.equal(relayAction(recovered.b, true), 'start');
assert.equal(relayAction(recovered.b, false), 'idle');
const confirmed = { ...recovered.a, isOn: true, relayConfirmed: true };
assert.equal(relayAction(confirmed, true), 'noop');
assert.equal(relayAction(confirmed, false), 'end');
const previous = { a: { isOn: true, power: 30, currentProcessId: 12, relayConfirmed: true } };
const reconnected = recoverChargerStates(chargers, sessions, previous);
assert.equal(reconnected.a.currentProcessId, 12);
assert.equal(reconnected.a.power, 30);
assert.equal(reconnected.a.relayConfirmed, false);
const staleRuntime = { a: { isOn: true, power: 30, currentProcessId: 999 } };
assert.equal(recoverChargerStates(chargers, sessions, staleRuntime).a.currentProcessId, 12,
  'stale runtime session must not override persisted open session');
const closedOnly = recoverChargerStates(chargers, sessions.filter(p => p.endTime), staleRuntime);
assert.equal(closedOnly.a.currentProcessId, null,
  'closed sessions must not be resurrected');
const appliances = [{ id: 'washer', name: 'Washer', topic: 'washer', notifyTopic: 'done' }];
const applianceHistory = [
  { id: 20, processType: 'appliance', applianceId: 'washer', startTime: '2026-01-01T10:00:00Z', endTime: null },
  { id: 21, processType: 'appliance', applianceId: 'washer', startTime: '2026-01-01T11:00:00Z', endTime: null }
];
const recoveredAppliance = recoverApplianceStates(appliances, applianceHistory).washer;
assert.equal(recoveredAppliance.currentProcessId, 21);
assert.equal(recoveredAppliance.isRunning, true);
assert.equal(recoveredAppliance.telemetryConfirmed, false);
assert.equal(recoveredAppliance.cycleEndDetectedAt, null);
assert.equal(recoverApplianceStates(appliances, []).washer.isRunning, false);
assert.equal(recoverApplianceStates(appliances, applianceHistory,
  { washer: { currentProcessId: 999, power: 0, telemetryConfirmed: true } }).washer.currentProcessId, 21);
console.log('MQTT charger and appliance recovery regression tests passed');
