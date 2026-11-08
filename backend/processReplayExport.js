'use strict';
/**
 * Converts persisted ChargeBot processes into anonymized replay candidates.
 * A completed session is NOT automatically labeled as a completed charge:
 * operator must independently verify each candidate before replay.
 */
function convertProcesses(processes, { includeActive = false, minSamples = 20 } = {}) {
  if (!Array.isArray(processes)) throw new TypeError('Expected processes array');
  const traces = [];
  const skipped = { appliance: 0, active: 0, insufficientSamples: 0, invalid: 0 };
  for (const process of processes) {
    if (!process || !Array.isArray(process.events)) { skipped.invalid++; continue; }
    if (process.processType === 'appliance') { skipped.appliance++; continue; }
    if (!process.endTime && !includeActive) { skipped.active++; continue; }
    const samples = process.events.filter(e => e.type === 'power_consumption' &&
      typeof e.value === 'number' && Number.isFinite(e.value) &&
      typeof e.timestamp === 'string' && Number.isFinite(Date.parse(e.timestamp)))
      .map(e => ({ timestamp: e.timestamp, watts: e.value }))
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    if (samples.length < minSamples) { skipped.insufficientSamples++; continue; }
    // Preserve relative time spacing, but not real timestamps. Use fixed
    // reference time, and avoid retaining source process/device IDs or names.
    const origin = Date.parse(samples[0].timestamp);
    const base = Date.parse('2020-01-01T00:00:00.000Z');
    const shifted = samples.map(e => ({
      timestamp: new Date(base + Date.parse(e.timestamp) - origin).toISOString(),
      watts: e.watts
    }));
    traces.push({
      expectedReady: null,
      evaluationTime: shifted[shifted.length - 1].timestamp,
      samples: shifted
    });
  }
  return { traces, skipped };
}
module.exports = { convertProcesses };
