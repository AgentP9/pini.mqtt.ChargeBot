'use strict';
const fs = require('node:fs');
const { convertProcesses } = require('./processReplayExport');
const { replayTraces } = require('./replay-real-traces');

function usage() {
  console.error('Usage: node backend/export-process-replays.js <processes.json> <output.json> [--include-active]');
  console.error('Output contains no device names/IDs and expectedReady:null; label each trace manually before replay.');
}
if (require.main === module) {
  const [input, output, flag] = process.argv.slice(2);
  if (!input || !output || (flag && flag !== '--include-active') || input === output) {
    usage(); process.exit(2);
  }
  try {
    const raw = JSON.parse(fs.readFileSync(input, 'utf8'));
    const { traces, skipped } = convertProcesses(raw, { includeActive: flag === '--include-active' });
    fs.writeFileSync(output, JSON.stringify(traces, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ exported: traces.length, skipped, output, requiresIndependentLabels: true }));
  } catch (err) {
    console.error('Export failed:', err.message);
    process.exitCode = 1;
  }
}
module.exports = { convertProcesses };
