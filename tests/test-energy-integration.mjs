import assert from 'node:assert/strict';
import { calculateProcessEnergyWh } from '../frontend/src/utils/energy.mjs';
const start = Date.UTC(2026, 0, 1);
const sample = (minutes, power) => ({
  type: 'power_consumption',
  timestamp: new Date(start + minutes * 60000).toISOString(),
  value: power
});
assert.equal(calculateProcessEnergyWh({ events: [sample(0, 60), sample(1, 60)] }), 1);
assert.equal(calculateProcessEnergyWh({ events: [sample(0, 60), sample(1, 120)] }), 1.5);
assert.equal(calculateProcessEnergyWh({ events: [sample(0, 60), sample(10, 60)] }), 0);
assert.equal(calculateProcessEnergyWh({ events: [sample(1, 60), sample(0, 60)] }), 1);
assert.equal(calculateProcessEnergyWh({ events: [sample(0, -2), sample(1, 60)] }), 0);
assert.equal(calculateProcessEnergyWh({ events: [] }), 0);
console.log('Energy integration regression tests passed');
