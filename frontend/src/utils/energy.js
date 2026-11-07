/**
 * Estimate Wh from timestamped MQTT power samples.
 * Gaps beyond maxGapMs are not extrapolated, so the result is conservative.
 */
export function calculateProcessEnergyWh(process, maxGapMs = 120000) {
  const samples = (process?.events || [])
    .filter(e => e.type === 'power_consumption' && Number.isFinite(Number(e.value)) && Number(e.value) >= 0)
    .map(e => ({ time: Date.parse(e.timestamp), power: Number(e.value) }))
    .filter(e => Number.isFinite(e.time))
    .sort((a, b) => a.time - b.time);
  let wh = 0;
  for (let i = 1; i < samples.length; i++) {
    const elapsedMs = samples[i].time - samples[i - 1].time;
    if (elapsedMs > 0 && elapsedMs <= maxGapMs) {
      wh += (samples[i - 1].power + samples[i].power) / 2 * elapsedMs / 3600000;
    }
  }
  return wh;
}
