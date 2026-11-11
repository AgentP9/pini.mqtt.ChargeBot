'use strict';

// Deterministic replay suite: explicit positive and negative expectations.
// These fixtures are synthetic and do not contain production device data.
const assert = require('node:assert/strict');
const { assessCompletion } = require('../backend/completionAssessment');
const { isInCompletionPhase } = require('../backend/patternAnalyzer');
const now = Date.parse('2026-11-08T12:00:00Z');
const minute = 60000;
const sample = (ageMinutes, power) => ({
  type: 'power_consumption',
  timestamp: new Date(now - ageMinutes * minute).toISOString(), value: power
});
const regular = (power = 2) => Array.from({ length: 21 }, (_, i) => sample(20 - i, power));
const scenario = (name, events, expected, reason) => ({ name, events, expected, reason });
const fixtures = [
  scenario('sustained low power', regular(), true, 'stable_low_power'),
  scenario('active charging', regular(45), false, 'power_above_threshold'),
  scenario('intermittent load spike', regular().map((e, i) => i === 18 ? { ...e, value: 12 } : e), false, 'power_above_threshold'),
  scenario('negative sensor value', regular().map((e, i) => i === 16 ? { ...e, value: -1 } : e), false, 'power_above_threshold'),
  scenario('exact threshold boundary', regular(5), false, 'power_above_threshold'),
  scenario('telemetry outage', regular().map((e, i) => i >= 13 && i <= 16 ? { ...e, timestamp: new Date(now - 900000).toISOString() } : e), false, 'telemetry_gap'),
  scenario('missing recent samples', regular().map(e => ({ ...e, timestamp: new Date(Date.parse(e.timestamp) - 180000).toISOString() })), false, 'telemetry_stale'),
  scenario('too few samples', regular().slice(-5), false, 'insufficient_samples'),
  scenario('future-only telemetry', regular().map(e => ({ ...e, timestamp: new Date(now + minute).toISOString() })), false, 'insufficient_samples'),
  scenario('out of order samples', [...regular()].reverse(), true, 'stable_low_power'),
  scenario('duplicated timestamps', [...regular(), ...regular().slice(-3)], true, 'stable_low_power'),
  scenario('charging resumed', regular().map((e, i) => i > 16 ? { ...e, value: 25 } : e), false, 'power_above_threshold')
];
const report = [];
for (const fixture of fixtures) {
  const process = { id: fixture.name, events: fixture.events, endTime: null };
  const assessment = assessCompletion(process, { now });
  const legacy = isInCompletionPhase(process, 5, 10, now);
  assert.equal(assessment.ready, fixture.expected, fixture.name);
  assert.equal(assessment.reason, fixture.reason, fixture.name);
  // Both detectors are expected to remain conservative for known negatives.
  if (!fixture.expected) assert.equal(legacy, false, `Legacy false positive: ${fixture.name}`);
  report.push({ name: fixture.name, expected: fixture.expected, advisory: assessment.ready,
    legacy, agrees: assessment.ready === legacy, reason: assessment.reason });
}
assert.equal(report.filter(r => !r.agrees).length, 0, 'Detector disagreement requires investigation');
console.log(JSON.stringify({ fixtures: report.length, disagreements: 0, results: report }, null, 2));
