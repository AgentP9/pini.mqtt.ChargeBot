'use strict';
const assert = require('node:assert/strict');
const { assessCompletion } = require('../backend/completionAssessment');
const { isInCompletionPhase } = require('../backend/patternAnalyzer');
const now = Date.parse('2026-11-08T12:00:00Z');
const make = (power = 2) => ({ id: 1, endTime: null, events:
  Array.from({ length: 21 }, (_, i) => ({
    type: 'power_consumption', timestamp: new Date(now - (20 - i) * 60000).toISOString(), value: power
  }))
});
const baseline = make();
assert.equal(assessCompletion(baseline, { now }).ready, true);
assert.equal(isInCompletionPhase(baseline, 5, 10, now), true);
const cases = [
  [() => ({ ...baseline, endTime: new Date(now).toISOString() }), 'inactive_session'],
  [() => ({ ...baseline, events: baseline.events.slice(-3) }), 'insufficient_samples'],
  [() => ({ ...baseline, events: baseline.events.map((e, i) => i === 19 ? { ...e, value: 20 } : e) }), 'power_above_threshold'],
  [() => ({ ...baseline, events: baseline.events.map((e, i) => i >= 13 && i <= 15 ? { ...e, timestamp: new Date(now - 900000).toISOString() } : e) }), 'telemetry_gap'],
  [() => ({ ...baseline, events: baseline.events.map(e => ({ ...e, timestamp: new Date(Date.parse(e.timestamp) - 300000).toISOString() })) }), 'telemetry_stale']
];
for (const [create, reason] of cases) {
  const result = assessCompletion(create(), { now });
  assert.equal(result.ready, false, reason);
  assert.equal(result.reason, reason);
}
console.log('Sprint 6 explainable completion fixtures passed');
