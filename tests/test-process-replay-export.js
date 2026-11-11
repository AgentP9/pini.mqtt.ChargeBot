'use strict';
const assert = require('node:assert/strict');
const { convertProcesses } = require('../backend/processReplayExport');
const { replayTraces } = require('../backend/replay-real-traces');
const base = Date.parse('2026-11-08T12:00:00Z');
const process = {
  id: 123, chargerId: 'private-charger', deviceName: 'Secret Device',
  chargerName: 'Garage', endTime: new Date(base).toISOString(),
  events: Array.from({ length: 21 }, (_, i) => ({
    type: 'power_consumption',
    timestamp: new Date(base - (20 - i) * 60000).toISOString(), value: 2
  }))
};
const { traces, skipped } = convertProcesses([process, { ...process, processType: 'appliance' },
  { ...process, endTime: null }]);
assert.equal(traces.length, 1);
assert.equal(skipped.appliance, 1);
assert.equal(skipped.active, 1);
assert.equal(traces[0].expectedReady, null);
const serialized = JSON.stringify(traces);
for (const sensitive of ['Secret Device', 'private-charger', 'Garage', '2026-11-08', '123']) {
  assert.equal(serialized.includes(sensitive), false, `leaked: ${sensitive}`);
}
assert.equal(Date.parse(traces[0].samples[1].timestamp) - Date.parse(traces[0].samples[0].timestamp), 60000);
const verified = [{ ...traces[0], expectedReady: true }];
const results = replayTraces(verified);
assert.equal(results[0].falsePositive, false);
assert.equal(results[0].disagreement, false);
assert.throws(() => replayTraces(traces), /Invalid trace/);
console.log('History export and independent-label replay tests passed');
