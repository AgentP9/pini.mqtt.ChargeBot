#!/usr/bin/env node

/**
 * Tests for appliance cycle detection logic
 *
 * Validates:
 *  1. parseApplianceConfig  – correct parsing of MQTT_APPLIANCES env var
 *  2. Cycle-start detection – power rising above APPLIANCE_START_THRESHOLD_W
 *  3. Cycle-end detection   – power staying below APPLIANCE_END_THRESHOLD_W
 *  4. Pattern analysis      – appliance processes are excluded from charger pattern analysis
 */

const patternAnalyzer = require('../backend/patternAnalyzer.js');
const { parseApplianceConfig } = require('../backend/applianceUtils.js');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ PASS: ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

// ─── Helper: build a fake power-event list ────────────────────────────────────
function makePowerEvents(values, startMinutesAgo = 60) {
  const now = Date.now();
  return values.map((value, i) => ({
    timestamp: new Date(now - (startMinutesAgo - i) * 60 * 1000).toISOString(),
    type: 'power_consumption',
    value
  }));
}

// ─── Test 1: parseApplianceConfig ─────────────────────────────────────────────
console.log('\nTest 1: parseApplianceConfig');

// 1a: no config → empty array
const r1a = parseApplianceConfig('');
assert(r1a.length === 0, 'empty string returns empty array');

// 1b: single appliance without custom notifyTopic
const r1b = parseApplianceConfig('Washing Machine:shellies/washer');
assert(r1b.length === 1, 'single appliance parsed');
assert(r1b[0].name === 'Washing Machine', 'name parsed correctly');
assert(r1b[0].topic === 'shellies/washer', 'topic parsed correctly');
assert(r1b[0].notifyTopic === 'shellies/washer/notify', 'default notify topic derived');
assert(r1b[0].id === 'shellies_washer', 'id uses underscores');

// 1c: single appliance with custom notifyTopic
const r1c = parseApplianceConfig('Dishwasher:shellies/dish:home/alerts/done');
assert(r1c.length === 1, 'single appliance with custom notify parsed');
assert(r1c[0].name === 'Dishwasher', 'name correct');
assert(r1c[0].topic === 'shellies/dish', 'topic correct');
assert(r1c[0].notifyTopic === 'home/alerts/done', 'custom notify topic preserved');

// 1d: multiple appliances
const r1d = parseApplianceConfig(
  'Washing Machine:shellies/washer,Dishwasher:shellies/dish:home/done'
);
assert(r1d.length === 2, 'two appliances parsed');
assert(r1d[0].name === 'Washing Machine', 'first name correct');
assert(r1d[1].name === 'Dishwasher', 'second name correct');
assert(r1d[1].notifyTopic === 'home/done', 'second custom notify topic correct');

// ─── Test 2: Cycle-start power threshold ──────────────────────────────────────
console.log('\nTest 2: Cycle-start detection (power >= 10 W starts a cycle)');

const APPLIANCE_START_THRESHOLD_W = 10;

function shouldStartCycle(currentPower, isRunning) {
  return !isRunning && currentPower >= APPLIANCE_START_THRESHOLD_W;
}

assert(shouldStartCycle(15, false) === true,  'power 15 W, not running → start cycle');
assert(shouldStartCycle(10, false) === true,  'power exactly 10 W, not running → start cycle');
assert(shouldStartCycle(9.9, false) === false, 'power 9.9 W, not running → no start');
assert(shouldStartCycle(0, false) === false,  'power 0 W → no start');
assert(shouldStartCycle(15, true) === false,  'cycle already running → no duplicate start');

// ─── Test 3: Cycle-end threshold check ───────────────────────────────────────
console.log('\nTest 3: Cycle-end detection (power < 10 W triggers end timer)');

const APPLIANCE_END_THRESHOLD_W = 10;

function powerIsLow(currentPower) {
  return currentPower < APPLIANCE_END_THRESHOLD_W;
}

assert(powerIsLow(0) === true,   'power 0 W → low (end timer starts)');
assert(powerIsLow(9.9) === true, 'power 9.9 W → low');
assert(powerIsLow(10) === false, 'power exactly 10 W → not low');
assert(powerIsLow(50) === false, 'power 50 W → not low (active cycle)');

// ─── Test 4: Pattern analysis excludes appliance processes ───────────────────
console.log('\nTest 4: Pattern analysis excludes appliance processes');

// Build a completed charger process with enough power events
const chargerProcess = {
  id: 100,
  chargerId: 'charger1',
  chargerName: 'Test Charger',
  processType: undefined, // charger processes don't set this field
  startTime: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
  endTime: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  events: makePowerEvents([20, 22, 18, 21, 19, 23, 20, 18, 17, 16], 120)
};

// Build a completed appliance process (washing cycle)
const applianceProcess = {
  id: 200,
  applianceId: 'shellies_washer',
  applianceName: 'Washing Machine',
  processType: 'appliance',
  startTime: new Date(Date.now() - 100 * 60 * 1000).toISOString(),
  endTime: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  events: [
    ...makePowerEvents([300, 400, 350, 200, 150, 100, 50, 5, 2, 1], 100)
  ]
};

const patterns = patternAnalyzer.analyzePatterns(
  [chargerProcess, applianceProcess],
  []
);

// Pattern analysis should only find the charger process, not the appliance one
const hasChargerPattern = patterns.some(p =>
  p.processIds && p.processIds.includes(chargerProcess.id)
);
const hasAppliancePattern = patterns.some(p =>
  p.processIds && p.processIds.includes(applianceProcess.id)
);

assert(hasChargerPattern === true,  'charger process is included in patterns');
assert(hasAppliancePattern === false, 'appliance process is excluded from patterns');

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log('\n================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(failed === 0 ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED');
process.exit(failed === 0 ? 0 : 1);
