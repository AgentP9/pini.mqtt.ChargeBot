'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateProcesses } = require('../backend/processIntegrity');

const valid = [{ id: 1, startTime: '2026-01-01T00:00:00Z', endTime: null, events: [] }];
assert.equal(validateProcesses(valid), valid);
for (const invalid of [
  {},
  [{ ...valid[0], id: 0 }],
  [valid[0], { ...valid[0] }],
  [{ ...valid[0], startTime: 'not a date' }],
  [{ ...valid[0], events: null }],
  [{ ...valid[0], endTime: '2025-01-01T00:00:00Z' }]
]) assert.throws(() => validateProcesses(invalid));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chargebot-integrity-'));
process.env.DATA_DIR = dir;
const storage = require('../backend/storage');
try {
  assert.deepEqual(storage.loadProcesses(), []);
  storage.saveProcesses(valid);
  assert.deepEqual(storage.loadProcesses(), valid);
  storage.saveProcesses([{ ...valid[0], id: 2 }]);
  const backup = path.join(dir, 'charging-processes.json.bak');
  assert.deepEqual(JSON.parse(fs.readFileSync(backup, 'utf8')), valid);
  assert.deepEqual(storage.loadProcesses(), [{ ...valid[0], id: 2 }]);
  fs.writeFileSync(path.join(dir, 'charging-processes.json'), '{broken', 'utf8');
  assert.throws(() => storage.loadProcesses(), SyntaxError);
  assert.equal(fs.readFileSync(path.join(dir, 'charging-processes.json'), 'utf8'), '{broken');
  assert.deepEqual(JSON.parse(fs.readFileSync(backup, 'utf8')), valid,
    'corruption must not overwrite the last-known-good backup');
  assert.throws(() => storage.saveProcesses(valid), SyntaxError,
    'writing must not overwrite a corrupted primary without manual recovery');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('Process storage integrity tests passed');
