const assert = require('assert');
const { removeOldCompletedProcesses } = require('../backend/processCleanup');

const cutoff = new Date('2026-01-01T00:00:00.000Z');
const processes = [
  { id: 1, startTime: '2025-12-01T00:00:00.000Z', endTime: '2025-12-01T01:00:00.000Z' },
  { id: 2, startTime: '2026-01-01T00:00:00.000Z', endTime: '2026-01-01T01:00:00.000Z' },
  { id: 3, startTime: '2025-11-01T00:00:00.000Z', endTime: null },
  { id: 4, startTime: '2025-11-01T00:00:00.000Z', endTime: '2025-11-01T01:00:00.000Z', processType: 'appliance' },
  { id: 5, startTime: 'invalid', endTime: '2025-11-01T01:00:00.000Z' }
];

const result = removeOldCompletedProcesses(processes, cutoff);

assert.deepStrictEqual(result.removed.map(process => process.id), [1]);
assert.deepStrictEqual(result.remaining.map(process => process.id), [2, 3, 4, 5]);
assert.throws(() => removeOldCompletedProcesses(processes, 'invalid'), /Invalid cleanup cutoff/);

console.log('Process cleanup tests passed');
