function removeOldCompletedProcesses(processes, cutoff) {
  const cutoffTime = new Date(cutoff).getTime();
  if (!Number.isFinite(cutoffTime)) {
    throw new Error('Invalid cleanup cutoff');
  }

  const removed = [];
  const remaining = processes.filter(process => {
    const startTime = new Date(process.startTime).getTime();
    const shouldRemove = process.processType !== 'appliance' &&
      process.endTime &&
      Number.isFinite(startTime) &&
      startTime < cutoffTime;

    if (shouldRemove) {
      removed.push(process);
    }

    return !shouldRemove;
  });

  return { remaining, removed };
}

module.exports = { removeOldCompletedProcesses };
