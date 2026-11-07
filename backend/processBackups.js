'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { validateProcesses } = require('./processIntegrity');

const DEFAULT_RETENTION = 5;
function backupPaths(primary, retention = DEFAULT_RETENTION) {
  if (!Number.isInteger(retention) || retention < 1 || retention > 50) {
    throw new Error('Backup retention must be an integer from 1 to 50');
  }
  return Array.from({ length: retention }, (_, i) =>
    i === 0 ? `${primary}.bak` : `${primary}.bak.${i}`);
}

function readValidated(file) {
  return validateProcesses(JSON.parse(fs.readFileSync(file, 'utf8')));
}

/**
 * Keep .bak as the newest previous snapshot, .bak.1 as the next oldest.
 * Validate the source before touching any existing backup.
 */
function rotateBackup(primary, retention = DEFAULT_RETENTION) {
  if (!fs.existsSync(primary)) return;
  const data = fs.readFileSync(primary, 'utf8');
  validateProcesses(JSON.parse(data));
  const paths = backupPaths(primary, retention);
  const temp = `${paths[0]}.tmp`;
  fs.writeFileSync(temp, data, 'utf8');
  try {
    if (fs.existsSync(paths[paths.length - 1])) fs.unlinkSync(paths[paths.length - 1]);
    for (let i = paths.length - 2; i >= 0; i--) {
      if (fs.existsSync(paths[i])) fs.renameSync(paths[i], paths[i + 1]);
    }
    fs.renameSync(temp, paths[0]);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function listBackups(primary, retention = DEFAULT_RETENTION) {
  return backupPaths(primary, retention).map((file, index) => {
    if (!fs.existsSync(file)) return null;
    try {
      const processes = readValidated(file);
      const stat = fs.statSync(file);
      return { index, file: path.basename(file), valid: true,
        count: processes.length, modifiedAt: stat.mtime.toISOString() };
    } catch (error) {
      return { index, file: path.basename(file), valid: false,
        error: error.message };
    }
  }).filter(Boolean);
}

/**
 * Offline-only recovery. Caller must stop the server. No automatic fallback.
 * Require an explicit index, and preserve the damaged original.
 */
function restoreBackup(primary, index, retention = DEFAULT_RETENTION) {
  if (!Number.isInteger(index) || index < 0 || index >= retention) {
    throw new Error('Explicit valid backup index required');
  }
  const source = backupPaths(primary, retention)[index];
  const processes = readValidated(source);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const quarantine = `${primary}.pre-restore-${stamp}`;
  const temp = `${primary}.restore.tmp`;
  fs.copyFileSync(source, temp);
  try {
    if (fs.existsSync(primary)) fs.copyFileSync(primary, quarantine, fs.constants.COPYFILE_EXCL);
    fs.renameSync(temp, primary);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  return { restoredFrom: path.basename(source), count: processes.length,
    preservedOriginal: fs.existsSync(quarantine) ? path.basename(quarantine) : null };
}

module.exports = { backupPaths, rotateBackup, listBackups, restoreBackup };
