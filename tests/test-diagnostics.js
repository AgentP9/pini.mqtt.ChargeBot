'use strict';
const assert = require('node:assert/strict');
const { createEventJournal, autoOffDiagnosis } = require('../backend/diagnostics');
const journal = createEventJournal({ limit: 3, now: () => '2026-11-07T00:00:00Z' });
journal.record('mqtt_connected');
journal.record('relay_transition', { chargerId: 'a' });
journal.record('mqtt_disconnected');
journal.record('mqtt_connected');
assert.equal(journal.stats().count, 3);
assert.deepEqual(journal.list().map(e => e.id), [2, 3, 4]);
assert.deepEqual(journal.list({ type: 'mqtt_connected' }).map(e => e.id), [4]);
assert.deepEqual(journal.list({ sinceId: 2 }).map(e => e.id), [3, 4]);
assert.throws(() => createEventJournal({ limit: 0 }));
const base = { mqttConnected: true, charger: { isOn: true, relayConfirmed: true },
  autoOff: { enabled: true }, process: { id: 1, endTime: null },
  lastPowerTimestamp: '2026-11-07T00:00:00Z', now: Date.parse('2026-11-07T00:00:30Z') };
assert.equal(autoOffDiagnosis(base).reason, 'monitoring');
assert.equal(autoOffDiagnosis({ ...base, mqttConnected: false }).reason, 'mqtt_disconnected');
assert.equal(autoOffDiagnosis({ ...base, charger: { isOn: true, relayConfirmed: false } }).reason, 'relay_unconfirmed');
assert.equal(autoOffDiagnosis({ ...base, lastPowerTimestamp: null }).reason, 'telemetry_stale');
assert.equal(autoOffDiagnosis({ ...base, autoOff: { enabled: false } }).reason, 'disabled');
console.log('Sprint 5 diagnostics tests passed');
