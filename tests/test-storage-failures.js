const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'chargebot-storage-'));
process.env.DATA_DIR = temp;
const storage = require('../backend/storage');
try {
  storage.saveProcesses([{ id: 1, events: [] }]);
  assert.equal(storage.loadProcesses()[0].id, 1);
  storage.saveAutoOffState({ charger: { enabled: true, revalidationTimer: {} } });
  assert.deepEqual(storage.loadAutoOffState(), { charger: { enabled: true } });

  // A failed write must never be silently reported as successful.
  const originalWrite = fs.writeFileSync;
  fs.writeFileSync = () => { throw new Error('simulated disk failure'); };
  try {
    assert.throws(() => storage.saveProcesses([]), /simulated disk failure/);
    assert.throws(() => storage.saveProcessCounter(5), /simulated disk failure/);
    assert.throws(() => storage.saveAutoOffState({}), /simulated disk failure/);
  } finally {
    fs.writeFileSync = originalWrite;
  }
  assert.equal(storage.loadProcesses()[0].id, 1, 'previous data must remain intact');
  console.log('Storage failure regression tests passed');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
