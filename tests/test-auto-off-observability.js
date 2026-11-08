'use strict';
const assert = require('node:assert/strict');
const { createEventJournal } = require('../backend/diagnostics');
const { createTransitionRecorder, evaluateRevalidation } = require('../backend/autoOffObservability');

const journal = createEventJournal();
const transitions = createTransitionRecorder(journal);
assert.equal(transitions.update('charger1', 'monitoring'), true);
assert.equal(transitions.update('charger1', 'monitoring'), false);
assert.equal(transitions.update('charger1', 'telemetry_stale'), true);
assert.equal(transitions.update('charger2', 'monitoring'), true);
assert.equal(journal.list().length, 3);
assert.equal(transitions.snapshot().charger1, 'telemetry_stale');

const now = Date.parse('2026-11-08T06:00:00Z');
const charger = { isOn: true, relayConfirmed: true, currentProcessId: 7 };
const process = { id: 7, endTime: null, events: [
  { type: 'power_consumption', timestamp: new Date(now - 30000).toISOString() }
] };
const base = { mqttConnected: true, enabled: true, charger, process,
  expectedProcessId: 7, completing: true, now };
assert.deepEqual(evaluateRevalidation(base), { allowed: true, reason: 'completion_confirmed' });
const cases = [
  [{ mqttConnected: false }, 'mqtt_disconnected'],
  [{ enabled: false }, 'disabled'],
  [{ charger: { ...charger, relayConfirmed: false } }, 'relay_unconfirmed_or_off'],
  [{ charger: { ...charger, isOn: false } }, 'relay_unconfirmed_or_off'],
  [{ charger: { ...charger, currentProcessId: 8 } }, 'session_changed'],
  [{ process: { ...process, endTime: '2026-11-08T05:59:59Z' } }, 'session_changed'],
  [{ process: { ...process, events: [] } }, 'telemetry_stale'],
  [{ process: { ...process, events: [{ type: 'power_consumption', timestamp: new Date(now - 120000).toISOString() }] } }, 'telemetry_stale'],
  [{ process: { ...process, events: [{ type: 'power_consumption', timestamp: new Date(now + 1000).toISOString() }] } }, 'telemetry_stale'],
  [{ completing: false }, 'charging_resumed']
];
for (const [override, reason] of cases) {
  const decision = evaluateRevalidation({ ...base, ...override });
  assert.deepEqual(decision, { allowed: false, reason });
}
console.log('Auto-off observability and safety matrix passed');
