'use strict';
// Offline replay of user-supplied, anonymized charging traces.
// Input: JSON array of { label, expectedReady, samples:[{ timestamp, watts }] }.
// Never logs sample values or device identifiers.
const fs = require('node:fs');
const { assessCompletion } = require('./completionAssessment');
const { isInCompletionPhase } = require('./patternAnalyzer');

function replayTraces(traces, { strict = true } = {}) {
  if (!Array.isArray(traces)) throw new TypeError('Expected an array of traces');
  return traces.map((trace, index) => {
    if (!trace || !Array.isArray(trace.samples) || !trace.samples.length ||
        trace.samples.length > 100000 || typeof trace.expectedReady !== 'boolean') {
      throw new TypeError(`Invalid trace at index ${index}`);
    }
    const events = trace.samples.map((sample, i) => {
      if (!sample || !Number.isFinite(Date.parse(sample.timestamp)) ||
          typeof sample.watts !== 'number' || !Number.isFinite(sample.watts)) {
        throw new TypeError(`Invalid sample at trace ${index}, index ${i}`);
      }
      return { type: 'power_consumption', timestamp: sample.timestamp, value: sample.watts };
    });
    const now = trace.evaluationTime ? Date.parse(trace.evaluationTime) :
      Math.max(...events.map(e => Date.parse(e.timestamp)));
    if (!Number.isFinite(now)) throw new TypeError(`Invalid evaluation time at index ${index}`);
    const process = { id: index, events, endTime: null };
    const advisory = assessCompletion(process, { now });
    const legacyReady = isInCompletionPhase(process, 5, 10, now);
    const falsePositive = (advisory.ready || legacyReady) && !trace.expectedReady;
    const falseNegative = !(advisory.ready && legacyReady) && trace.expectedReady;
    return { index, expectedReady: trace.expectedReady, advisoryReady: advisory.ready,
      advisoryReason: advisory.reason, legacyReady, disagreement: advisory.ready !== legacyReady,
      falsePositive, falseNegative };
  });
}

if (require.main === module) {
  const filename = process.argv[2];
  if (!filename) { console.error('Usage: node backend/replay-real-traces.js <anonymized-traces.json>'); process.exit(2); }
  try {
    const traces = JSON.parse(fs.readFileSync(filename, 'utf8'));
    const results = replayTraces(traces);
    const summary = { count: results.length,
      disagreements: results.filter(r => r.disagreement).length,
      falsePositives: results.filter(r => r.falsePositive).length,
      falseNegatives: results.filter(r => r.falseNegative).length,
      results };
    console.log(JSON.stringify(summary, null, 2));
    if (summary.falsePositives || summary.disagreements) process.exitCode = 1;
  } catch (error) {
    console.error(`Replay failed: ${error.message}`);
    process.exitCode = 2;
  }
}
module.exports = { replayTraces };
