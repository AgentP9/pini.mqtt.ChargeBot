const assert = require('node:assert/strict');
const { isInCompletionPhase } = require('../backend/patternAnalyzer');
const now = Date.UTC(2026, 0, 1, 12);
function session(values, spacingMinutes = 1) {
  return {
    id: 1, startTime: new Date(now - 3600000).toISOString(), endTime: null,
    events: values.map(([minutesAgo, power]) => ({
      timestamp: new Date(now - minutesAgo * 60000).toISOString(),
      type: 'power_consumption', value: power
    }))
  };
}
const sustained = session(Array.from({ length: 25 }, (_, i) => [24 - i, 2]));
assert.equal(isInCompletionPhase(sustained, 5, 10, now), true, 'sustained low power');
const shortDip = session([
  ...Array.from({ length: 20 }, (_, i) => [35 - i, 20]),
  ...Array.from({ length: 8 }, (_, i) => [7 - i, 2])
]);
assert.equal(isInCompletionPhase(shortDip, 5, 10, now), false, 'short dip is not completion');
const stale = session(Array.from({ length: 25 }, (_, i) => [40 - i, 2]));
assert.equal(isInCompletionPhase(stale, 5, 10, now), false, 'stale samples');
const gaps = session([...Array.from({ length: 20 }, (_, i) => [40 - i, 2]), [11, 2], [2, 2], [1, 2], [0, 2], [0.5, 2]]);
assert.equal(isInCompletionPhase(gaps, 5, 10, now), false, 'telemetry gap');
const spike = session(Array.from({ length: 25 }, (_, i) => [24 - i, i === 19 ? 8 : 2]));
assert.equal(isInCompletionPhase(spike, 5, 10, now), false, 'high power spike');
assert.equal(isInCompletionPhase({ ...sustained, endTime: new Date(now).toISOString() }, 5, 10, now), false, 'completed session');
console.log('Deterministic completion replay tests passed');
