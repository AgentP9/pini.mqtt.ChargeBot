'use strict';

/**
 * Validate persisted process history before allowing the backend to start.
 * Never silently replace a damaged history file with an empty array: doing so
 * could discard charging sessions on the next save.
 */
function validateProcesses(processes) {
  if (!Array.isArray(processes)) {
    throw new Error('Process history must be an array');
  }
  const ids = new Set();
  for (const [index, process] of processes.entries()) {
    if (!process || typeof process !== 'object' || Array.isArray(process)) {
      throw new Error(`Invalid process at index ${index}`);
    }
    if (!Number.isSafeInteger(process.id) || process.id < 1 || ids.has(process.id)) {
      throw new Error(`Invalid or duplicate process ID at index ${index}`);
    }
    ids.add(process.id);
    if (typeof process.startTime !== 'string' ||
        !Number.isFinite(Date.parse(process.startTime))) {
      throw new Error(`Invalid startTime for process ${process.id}`);
    }
    if (process.endTime != null &&
        (typeof process.endTime !== 'string' ||
         !Number.isFinite(Date.parse(process.endTime)) ||
         Date.parse(process.endTime) < Date.parse(process.startTime))) {
      throw new Error(`Invalid endTime for process ${process.id}`);
    }
    if (!Array.isArray(process.events)) {
      throw new Error(`Invalid events for process ${process.id}`);
    }
  }
  return processes;
}

module.exports = { validateProcesses };
