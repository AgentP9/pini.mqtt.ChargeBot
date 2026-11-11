'use strict';
const assert = require('node:assert/strict');
const { convertProcesses } = require('../backend/processReplayExport');
const now = Date.parse('2026-11-11T08:00:00Z');
const events = Array.from({ length: 21 }, (_, i) => ({
  type: 'power_consumption', value: 2,
  timestamp: new Date(now - (20 - i) * 60000).toISOString()
}));
const { traces, skipped } = convertProcesses([
  { id: 77, chargerId: 'secret', deviceName: 'private', endTime: new Date(now).toISOString(), events },
  { id: 78, endTime: null, events }
]);
assert.equal(traces.length, 1);
assert.equal(skipped.active, 1);
assert.equal(traces[0].expectedReady, null);
assert.equal(traces[0].samples.length, 21);
assert.equal(JSON.stringify(traces).includes('secret'), false);
assert.equal(JSON.stringify(traces).includes('private'), false);
assert.equal(JSON.stringify(traces).includes('2026-11-11'), false);
console.log('Sprint 9 dashboard export contract passed');
