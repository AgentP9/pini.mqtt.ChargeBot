#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { listBackups, restoreBackup } = require('./processBackups');

const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
const primary = path.join(dir, 'charging-processes.json');
const [command, rawIndex, confirmation] = process.argv.slice(2);

if (command === 'list') {
  console.log(JSON.stringify(listBackups(primary), null, 2));
} else if (command === 'restore') {
  const index = Number(rawIndex);
  if (!/^\d+$/.test(rawIndex || '') || !Number.isInteger(index) ||
      confirmation !== '--confirm-offline') {
    console.error('Usage: node recovery-cli.js restore <index> --confirm-offline');
    process.exitCode = 2;
  } else {
    try {
      // Offline confirmation is explicit; the operator must stop the service.
      console.log(JSON.stringify(restoreBackup(primary, index), null, 2));
    } catch (error) {
      console.error('Restore refused:', error.message);
      process.exitCode = 1;
    }
  }
} else {
  console.error('Usage: node recovery-cli.js list | restore <index> --confirm-offline');
  process.exitCode = 2;
}
