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

function makeDurationProcess(id, durationMinutes) {
  const process = makeProcess(id, [
    { value: 20, minute: 0 },
    { value: 50, minute: 1 },
    { value: 80, minute: 2 }
  ]);
  const startTime = Date.UTC(2026, 1, id);
  process.startTime = new Date(startTime).toISOString();
  process.endTime = new Date(startTime + durationMinutes * 60 * 1000).toISOString();
  process.events.forEach((event, index) => {
    event.timestamp = new Date(startTime + index * 60 * 1000).toISOString();
  });
  return process;
}

const evenDurationPatterns = patternAnalyzer.analyzePatterns([
  makeDurationProcess(10, 10),
  makeDurationProcess(11, 20),
  makeDurationProcess(12, 30),
  makeDurationProcess(13, 40)
], []);
assert.strictEqual(evenDurationPatterns.length, 1);
assert.strictEqual(evenDurationPatterns[0].statistics.medianDuration, 25);

const manualTarget = {
  id: 'manual-target',
  count: 0,
  processIds: [],
  averageProfile: null,
  statistics: null,
  firstSeen: rising.startTime,
  lastSeen: rising.endTime
};
const recognizedSource = {
  id: 'recognized-source',
  count: 1,
  processIds: [rising.id],
  averageProfile: risingProfile,
  statistics: { averageDuration: 60, minDuration: 60, maxDuration: 60, medianDuration: 60, totalSessions: 1 },
  firstSeen: rising.startTime,
  lastSeen: rising.endTime
};
const targetMergePatterns = [manualTarget, recognizedSource];
const targetMerge = patternAnalyzer.mergePatterns(
  targetMergePatterns,
  recognizedSource.id,
  manualTarget.id
);
assert.strictEqual(targetMerge.success, true);
assert.deepStrictEqual(targetMerge.mergedPattern.averageProfile, risingProfile);
assert.strictEqual(targetMerge.mergedPattern.statistics.totalSessions, 1);

const recognizedTarget = {
  ...recognizedSource,
  id: 'recognized-target',
  processIds: [rising.id]
};
const manualSource = {
  ...manualTarget,
  id: 'manual-source'
};
const sourceMerge = patternAnalyzer.mergePatterns(
  [recognizedTarget, manualSource],
  manualSource.id,
  recognizedTarget.id
);
assert.strictEqual(sourceMerge.success, true);
assert.deepStrictEqual(sourceMerge.mergedPattern.averageProfile, risingProfile);

console.log('Pattern identification tests passed');
