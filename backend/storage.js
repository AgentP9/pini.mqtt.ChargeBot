const fs = require('fs');
const path = require('path');

// Data directory for persistent storage
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PROCESSES_FILE = path.join(DATA_DIR, 'charging-processes.json');
const COUNTER_FILE = path.join(DATA_DIR, 'process-counter.json');
const AUTO_OFF_FILE = path.join(DATA_DIR, 'auto-off-state.json');

/**
 * Ensure the data directory exists
 */
function ensureDataDirectory() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`Created data directory: ${DATA_DIR}`);
  }
}

/**
 * Load charging processes from file
 * @returns {Array} Array of charging processes
 */
function loadProcesses() {
  ensureDataDirectory();
  
  try {
    if (fs.existsSync(PROCESSES_FILE)) {
      const data = fs.readFileSync(PROCESSES_FILE, 'utf8');
      const processes = JSON.parse(data);
      console.log(`Loaded ${processes.length} charging processes from storage`);
      return processes;
    }
  } catch (error) {
    console.error('Error loading processes from file:', error);
  }
  
  return [];
}

/**
 * Save charging processes to file
 * @param {Array} processes - Array of charging processes to save
 */
function saveProcesses(processes) {
  ensureDataDirectory();
  
  try {
    // Write to a temporary file first, then rename for atomic operation
    const tempFile = `${PROCESSES_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(processes, null, 2), 'utf8');
    fs.renameSync(tempFile, PROCESSES_FILE);
    console.log(`Saved ${processes.length} charging processes to storage`);
  } catch (error) {
    console.error('Error saving processes to file:', error);
    throw error;
  }
}

/**
 * Load process ID counter from file
 * @returns {number} The next process ID to use
 */
function loadProcessCounter() {
  ensureDataDirectory();
  
  try {
    if (fs.existsSync(COUNTER_FILE)) {
      const data = fs.readFileSync(COUNTER_FILE, 'utf8');
      const counter = JSON.parse(data);
      console.log(`Loaded process counter: ${counter.nextId}`);
      return counter.nextId;
    }
  } catch (error) {
    console.error('Error loading process counter from file:', error);
  }
  
  return 1;
}

/**
 * Save process ID counter to file
 * @param {number} counter - The next process ID to use
 */
function saveProcessCounter(counter) {
  ensureDataDirectory();
  
  try {
    const tempFile = `${COUNTER_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify({ nextId: counter }, null, 2), 'utf8');
    fs.renameSync(tempFile, COUNTER_FILE);
    console.log(`Saved process counter: ${counter}`);
  } catch (error) {
    console.error('Error saving process counter to file:', error);
    throw error;
  }
}

/**
 * Load auto-off state from file
 * @returns {Object} Object mapping charger IDs to their auto-off state
 */
function loadAutoOffState() {
  ensureDataDirectory();
  
  try {
    if (fs.existsSync(AUTO_OFF_FILE)) {
      const data = fs.readFileSync(AUTO_OFF_FILE, 'utf8');
      const autoOffState = JSON.parse(data);
      console.log(`Loaded auto-off state for ${Object.keys(autoOffState).length} chargers from storage`);
      return autoOffState;
    }
  } catch (error) {
    console.error('Error loading auto-off state from file:', error);
  }
  
  return {};
}

/**
 * Save auto-off state to file
 * @param {Object} autoOffState - Object mapping charger IDs to their auto-off state
 */
function saveAutoOffState(autoOffState) {
  ensureDataDirectory();
  
  try {
    // Create a clean version without timers (which can't be serialized)
    const cleanState = {};
    Object.keys(autoOffState).forEach(chargerId => {
      // Skip if the state object is null or undefined
      if (autoOffState[chargerId] && typeof autoOffState[chargerId].enabled !== 'undefined') {
        cleanState[chargerId] = {
          enabled: autoOffState[chargerId].enabled,
          // Don't persist completionDetectedAt or revalidationTimer
          // These are runtime-only state that should reset on restart
        };
      }
    });
    
    const tempFile = `${AUTO_OFF_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(cleanState, null, 2), 'utf8');
    fs.renameSync(tempFile, AUTO_OFF_FILE);
    console.log(`Saved auto-off state for ${Object.keys(cleanState).length} chargers to storage`);
  } catch (error) {
    console.error('Error saving auto-off state to file:', error);
    throw error;
  }
}

module.exports = {
  loadProcesses,
  saveProcesses,
  loadProcessCounter,
  saveProcessCounter,
  loadAutoOffState,
  saveAutoOffState
};
