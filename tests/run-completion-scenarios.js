#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isInCompletionPhase } = require('../backend/patternAnalyzer');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/completion-scenarios.json'), 'utf8'));
const now = Date.parse(fixture.now);
assert(Number.isFinite(now), 'fixture now must be a valid timestamp');
let passed = 0;
for (const scenario of fixture.cases) {
  assert.equal(typeof scenario.expected, 'boolean', scenario.name);
  const events = scenario.samples.map(([minutesAgo, value]) => ({
    timestamp: new Date(now - minutesAgo * 60000).toISOString(),
    type: 'power_consumption', value
  }));
  const process = {
    id: 1, startTime: new Date(now - 3600000).toISOString(),
    endTime: scenario.completed ? fixture.now : null, events
  };
  const actual = isInCompletionPhase(process, scenario.thresholdWatts ?? 5, scenario.stableMinutes ?? 10, now);
  assert.equal(actual, scenario.expected, `Replay scenario failed: ${scenario.name}`);
  console.log(`PASS ${scenario.name}`);
  passed++;
}
console.log(`${passed} completion replay scenarios passed`);
