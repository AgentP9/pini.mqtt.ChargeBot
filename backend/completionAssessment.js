'use strict';

// Explainable, read-only completion assessment. Existing automatic shutdown
// remains governed by the proven conservative completion detector.
function assessCompletion(process, { now = Date.now(), thresholdWatts = 5,
  stableMinutes = 10, minSamples = 20, maxGapMs = 120000 } = {}) {
  const reject = (reason, details = {}) => ({ ready: false, reason, ...details });
  if (!process || !Array.isArray(process.events) || process.endTime) return reject('inactive_session');
  if (!Number.isFinite(now) || !Number.isFinite(thresholdWatts) || thresholdWatts <= 0 ||
      !Number.isFinite(stableMinutes) || stableMinutes <= 0) return reject('invalid_configuration');
  const events = process.events.filter(e => e.type === 'power_consumption' &&
    typeof e.value === 'number' && Number.isFinite(e.value))
    .map(e => ({ time: Date.parse(e.timestamp), power: e.value }))
    .filter(e => Number.isFinite(e.time) && e.time <= now)
    .sort((a, b) => a.time - b.time);
  if (events.length < minSamples) return reject('insufficient_samples', { sampleCount: events.length });
  const windowMs = stableMinutes * 60000;
  const start = now - windowMs;
  const baseline = [...events].reverse().find(e => e.time <= start);
  const recent = events.filter(e => e.time > start);
  if (!baseline || recent.length < 5) return reject('insufficient_window_coverage', { sampleCount: recent.length });
  const lastAgeMs = now - recent[recent.length - 1].time;
  if (lastAgeMs > maxGapMs) return reject('telemetry_stale', { lastAgeMs });
  const samples = [baseline, ...recent];
  for (let i = 1; i < samples.length; i++) {
    const from = Math.max(samples[i - 1].time, start);
    if (samples[i].time - from > Math.min(maxGapMs, windowMs / 2)) return reject('telemetry_gap');
  }
  if (samples.some(e => e.power < 0 || e.power >= thresholdWatts)) return reject('power_above_threshold');
  const preceding = events.filter(e => e.time >= start - 300000 && e.time <= start);
  if (preceding.length >= 3) {
    const previousMean = preceding.reduce((sum, e) => sum + e.power, 0) / preceding.length;
    const currentMean = recent.reduce((sum, e) => sum + e.power, 0) / recent.length;
    if (currentMean > previousMean * 1.2) return reject('rising_power_trend');
  }
  return { ready: true, reason: 'stable_low_power', sampleCount: recent.length, lastAgeMs };
}
module.exports = { assessCompletion };
