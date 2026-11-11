'use strict';
const assert = require('node:assert/strict');
const { replayTraces } = require('../backend/replay-real-traces');
const now = Date.parse('2026-11-08T12:00:00Z');
const samples = watts => Array.from({ length: 21 }, (_, i) => ({
  timestamp: new Date(now - (20 - i) * 60000).toISOString(), watts
}));
const results = replayTraces([
  { expectedReady: true, samples: samples(2), evaluationTime: new Date(now).toISOString() },
  { expectedReady: false, samples: samples(35), evaluationTime: new Date(now).toISOString() }
]);
assert.equal(results.length, 2);
assert.equal(results.some(r => r.falsePositive), false);
assert.equal(results.some(r => r.disagreement), false);
assert.throws(() => replayTraces([{ expectedReady: false, samples: [{ timestamp: 'bad', watts: 2 }] }]), /Invalid sample/);
assert.throws(() => replayTraces([{ expectedReady: false, samples: [] }]), /Invalid trace/);
console.log('Offline real-trace replay harness passed');
