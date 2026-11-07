'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { rotateBackup, listBackups, restoreBackup } = require('../backend/processBackups');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chargebot-rotation-'));
const primary = path.join(dir, 'charging-processes.json');
const history = n => [{ id: n, startTime: '2026-01-01T00:00:00Z', endTime: null, events: [] }];
const write = n => fs.writeFileSync(primary, JSON.stringify(history(n)));
try {
  for (let n = 1; n <= 8; n++) {
    write(n);
    rotateBackup(primary);
  }
  const backups = listBackups(primary);
  assert.equal(backups.length, 5);
  assert.ok(backups.every(b => b.valid));
  assert.deepEqual(backups.map(b => b.count), [1, 1, 1, 1, 1]);
  assert.deepEqual(JSON.parse(fs.readFileSync(primary + '.bak')), history(8));
  assert.deepEqual(JSON.parse(fs.readFileSync(primary + '.bak.4')), history(4));

  fs.writeFileSync(primary, '{broken');
  assert.throws(() => rotateBackup(primary));
  assert.deepEqual(JSON.parse(fs.readFileSync(primary + '.bak')), history(8));

  assert.throws(() => restoreBackup(primary, 99));
  const restored = restoreBackup(primary, 1);
  assert.equal(restored.restoredFrom, 'charging-processes.json.bak.1');
  assert.equal(restored.count, 1);
  assert.ok(restored.preservedOriginal);
  assert.equal(fs.readFileSync(path.join(dir, restored.preservedOriginal), 'utf8'), '{broken');
  assert.deepEqual(JSON.parse(fs.readFileSync(primary)), history(7));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('Backup rotation and offline recovery tests passed');
