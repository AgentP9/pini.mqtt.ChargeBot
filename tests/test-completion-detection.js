#!/usr/bin/env node

/**
 * Test for completion phase detection
 * Tests that the isInCompletionPhase function works correctly
 */

const patternAnalyzer = require('../backend/patternAnalyzer.js');

console.log('Completion Phase Detection Test');
console.log('================================\n');

// Test 1: Process with high power consumption (not completing)
console.log('Test 1: Active charging with high power (should NOT be completing)');
const activeProcess = {
  id: 1,
  chargerId: 'charger1',
  startTime: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 minutes ago
  endTime: null,
  events: []
};

// Add high power events in the last 10 minutes
for (let i = 0; i < 15; i++) {
  const timestamp = new Date(Date.now() - (10 - i * 0.7) * 60 * 1000).toISOString();
  activeProcess.events.push({
    timestamp: timestamp,
    type: 'power_consumption',
    value: 15 + 5 // 15-25W
  });
}

const isCompleting1 = patternAnalyzer.isInCompletionPhase(activeProcess);
console.log(`Result: ${isCompleting1 ? 'COMPLETING ✗' : 'NOT COMPLETING ✓'}`);
console.log(`Expected: false, Got: ${isCompleting1}`);
console.log(isCompleting1 === false ? '✓ PASS\n' : '✗ FAIL\n');

// Test 2: Process with low power consumption (completing)
console.log('Test 2: Charging with low power for 10+ minutes (should be completing)');
const completingProcess = {
  id: 2,
  chargerId: 'charger1',
  startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
  endTime: null,
  events: []
};

// Add high power events initially (15-20 minutes ago)
for (let i = 0; i < 15; i++) {
  const timestamp = new Date(Date.now() - (50 - i * 2) * 60 * 1000).toISOString();
  completingProcess.events.push({
    timestamp: timestamp,
    type: 'power_consumption',
    value: 20 + 5 // 20-30W
  });
}

// Add low power events in the last 12 minutes (to exceed 10-minute threshold)
for (let i = 0; i < 15; i++) {
  const timestamp = new Date(Date.now() - (12 - i * 0.8) * 60 * 1000).toISOString();
  completingProcess.events.push({
    timestamp: timestamp,
    type: 'power_consumption',
    value: 2 + 1 // 2-4W (below 5W threshold)
  });
}

const isCompleting2 = patternAnalyzer.isInCompletionPhase(completingProcess);
console.log(`Result: ${isCompleting2 ? 'COMPLETING ✓' : 'NOT COMPLETING ✗'}`);
console.log(`Expected: true, Got: ${isCompleting2}`);
console.log(isCompleting2 === true ? '✓ PASS\n' : '✗ FAIL\n');

// Test 3: Process with insufficient data (not completing)
console.log('Test 3: Process with insufficient data (should NOT be completing)');
const insufficientProcess = {
  id: 3,
  chargerId: 'charger1',
  startTime: new Date(Date.now() - 2 * 60 * 1000).toISOString(), // 2 minutes ago
  endTime: null,
  events: [
    { timestamp: new Date(Date.now() - 60 * 1000).toISOString(), type: 'power_consumption', value: 2 },
    { timestamp: new Date().toISOString(), type: 'power_consumption', value: 3 }
  ]
};

const isCompleting3 = patternAnalyzer.isInCompletionPhase(insufficientProcess);
console.log(`Result: ${isCompleting3 ? 'COMPLETING ✗' : 'NOT COMPLETING ✓'}`);
console.log(`Expected: false, Got: ${isCompleting3}`);
console.log(isCompleting3 === false ? '✓ PASS\n' : '✗ FAIL\n');

// Test 4: Completed process (should not be completing)
console.log('Test 4: Completed process (should NOT be completing)');
const completedProcess = {
  id: 4,
  chargerId: 'charger1',
  startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  endTime: new Date().toISOString(),
  events: [
    { timestamp: new Date(Date.now() - 60 * 1000).toISOString(), type: 'power_consumption', value: 2 },
    { timestamp: new Date().toISOString(), type: 'power_consumption', value: 3 }
  ]
};

const isCompleting4 = patternAnalyzer.isInCompletionPhase(completedProcess);
console.log(`Result: ${isCompleting4 ? 'COMPLETING ✗' : 'NOT COMPLETING ✓'}`);
console.log(`Expected: false, Got: ${isCompleting4}`);
console.log(isCompleting4 === false ? '✓ PASS\n' : '✗ FAIL\n');

// Test 5: Process with low power but increasing trend (should NOT be completing)
console.log('Test 5: Low power but increasing trend (should NOT be completing)');
const increasingPowerProcess = {
  id: 5,
  chargerId: 'charger1',
  startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  endTime: null,
  events: []
};

// Add older events with high power (30+ minutes ago) to ensure we have enough total events
for (let i = 0; i < 10; i++) {
  const timestamp = new Date(Date.now() - (40 - i * 2) * 60 * 1000).toISOString();
  increasingPowerProcess.events.push({
    timestamp: timestamp,
    type: 'power_consumption',
    value: 15 + 2.5 // 15-20W
  });
}

// Add buffer period with lower power (10-15 minutes ago)
for (let i = 0; i < 8; i++) {
  const timestamp = new Date(Date.now() - (15 - i * 0.625) * 60 * 1000).toISOString();
  increasingPowerProcess.events.push({
    timestamp: timestamp,
    type: 'power_consumption',
    value: 1.5 + 0.5 // 1.5-2.5W
  });
}

// Add recent period with higher (but still low) power in last 10 minutes
for (let i = 0; i < 12; i++) {
  const timestamp = new Date(Date.now() - (10 - i * 0.833) * 60 * 1000).toISOString();
  increasingPowerProcess.events.push({
    timestamp: timestamp,
    type: 'power_consumption',
    value: 3 + 0.75 // 3-4.5W (still below 5W but 50%+ higher than buffer period)
  });
}

const isCompleting5 = patternAnalyzer.isInCompletionPhase(increasingPowerProcess);
console.log(`Result: ${isCompleting5 ? 'COMPLETING ✗' : 'NOT COMPLETING ✓'}`);
console.log(`Expected: false, Got: ${isCompleting5}`);
console.log(isCompleting5 === false ? '✓ PASS\n' : '✗ FAIL\n');

// Summary
console.log('================================');
const allPassed = !isCompleting1 && isCompleting2 && !isCompleting3 && !isCompleting4 && !isCompleting5;
console.log(allPassed ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED');
process.exit(allPassed ? 0 : 1);
