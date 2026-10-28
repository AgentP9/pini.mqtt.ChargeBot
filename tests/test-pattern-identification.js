const assert = require('assert');
const patternAnalyzer = require('../backend/patternAnalyzer.js');

function makeProcess(id, values, startMinute = 0) {
  const start = Date.UTC(2026, 0, id);
  return {
    id,
    chargerId: 'charger1',
    chargerName: 'Office Charger',
    startTime: new Date(start).toISOString(),
    endTime: new Date(start + 60 * 60 * 1000).toISOString(),
    events: values.map(({ value, minute }) => ({
      timestamp: new Date(start + (startMinute + minute) * 60 * 1000).toISOString(),
      type: 'power_consumption',
      value
    }))
  };
}

const rising = makeProcess(1, [
  { value: 20, minute: 0 },
  { value: 50, minute: 1 },
  { value: 80, minute: 2 }
]);
const falling = makeProcess(2, [
  { value: 80, minute: 0 },
  { value: 50, minute: 1 },
  { value: 20, minute: 2 }
]);
const shuffledRising = makeProcess(3, [
  { value: 80, minute: 2 },
  { value: 20, minute: 0 },
  { value: 50, minute: 1 }
]);

const risingProfile = patternAnalyzer.calculatePowerProfile(rising);
const fallingProfile = patternAnalyzer.calculatePowerProfile(falling);
const shuffledRisingProfile = patternAnalyzer.calculatePowerProfile(shuffledRising);

assert.deepStrictEqual(shuffledRisingProfile.curveShape, risingProfile.curveShape);
assert.strictEqual(patternAnalyzer.calculateProfileSimilarity(risingProfile, risingProfile), 1);
const zeroProfile = {
  mean: 0,
  median: 0,
  stdDev: 0,
  peakPowerRatio: 0,
  curveShape: { early: 0, middle: 0, late: 0 }
};
assert.strictEqual(patternAnalyzer.calculateProfileSimilarity(zeroProfile, zeroProfile), 1);
assert(Number.isFinite(patternAnalyzer.calculateProfileSimilarity(zeroProfile, risingProfile)));
assert(
  patternAnalyzer.calculateProfileSimilarity(risingProfile, fallingProfile) < 0.65,
  'opposite power trends should not meet the pattern matching threshold'
);

const patterns = patternAnalyzer.analyzePatterns([rising, falling], []);
assert.strictEqual(patterns.length, 2, 'opposite power trends should form separate patterns');
assert(patterns.some(pattern => pattern.processIds.includes(rising.id)));
assert(patterns.some(pattern => pattern.processIds.includes(falling.id)));

console.log('Pattern identification tests passed');
