const express = require('express');
const cors = require('cors');
const mqtt = require('mqtt');
const dotenv = require('dotenv');
const storage = require('./storage');
const patternAnalyzer = require('./patternAnalyzer');
const { parseApplianceConfig } = require('./applianceUtils');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Persistent storage for charging processes
// Load existing processes from file
const chargingProcesses = storage.loadProcesses();
let processIdCounter = storage.loadProcessCounter();

// Pattern analysis storage
let chargingPatterns = patternAnalyzer.loadPatterns();

// Throttle mechanism for saving power consumption events
let saveTimer = null;
const SAVE_THROTTLE_MS = 5000; // Save at most once every 5 seconds

// Auto-off configuration
// Increased delay to provide more buffer time before turning off
const AUTO_OFF_DELAY_MS = 10 * 60 * 1000; // 10 minutes in milliseconds (increased from 5)
const AUTO_OFF_CHECK_INTERVAL_MS = 30000; // Check every 30 seconds

// Appliance monitoring configuration (e.g., washing machines)
// Appliances are never switched off automatically; only cycle start/end is detected
const APPLIANCE_START_THRESHOLD_W = 10; // Watts above which a cycle is considered started
const APPLIANCE_END_THRESHOLD_W = 10;   // Watts below which a cycle is considered ending
const APPLIANCE_END_STABLE_MS = 5 * 60 * 1000; // Power must stay below threshold for 5 minutes to confirm cycle end
const APPLIANCE_CHECK_INTERVAL_MS = 30000; // Check for cycle end every 30 seconds

function scheduleSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    storage.saveProcesses(chargingProcesses);
    saveTimer = null;
  }, SAVE_THROTTLE_MS);
}

// Function to run pattern analysis
async function runPatternAnalysis() {
  console.log('Running pattern analysis...');
  try {
    chargingPatterns = patternAnalyzer.analyzePatterns(chargingProcesses, chargingPatterns);
    patternAnalyzer.savePatterns(chargingPatterns);
    console.log(`Pattern analysis complete. Found ${chargingPatterns.length} patterns.`);
  } catch (error) {
    console.error('Error during pattern analysis:', error);
  }
}

/**
 * Try to auto-assign a device name to a process based on high-confidence pattern match
 * @param {Object} process - The charging process to potentially auto-assign
 * @param {number} processId - The ID of the process (for logging)
 * @returns {boolean} True if auto-assignment occurred, false otherwise
 */
function tryAutoAssignDeviceName(process, processId) {
  try {
    const match = patternAnalyzer.findMatchingPattern(process, chargingPatterns);
    if (match && match.similarity >= patternAnalyzer.HIGH_CONFIDENCE_THRESHOLD) {
      // Auto-assign the device name if we have high confidence
      process.deviceName = match.pattern.deviceName;
      console.log(`Auto-assigned device name "${match.pattern.deviceName}" to process ${processId} (confidence: ${match.similarity})`);
      return true;
    }
  } catch (error) {
    console.error(`Error during auto-assignment for process ${processId}:`, error);
  }
  return false;
}

// Current state of each charger (physical charging device like ShellyPlug)
const chargerStates = {};

// Current state of each monitored appliance (e.g., washing machine)
// Appliances are never switched off; cycles are detected by power threshold crossings
const applianceStates = {};

// Auto-off tracking for chargers
// Tracks which chargers have auto-off enabled and their completion timers
// Load persisted auto-off state from storage
const persistedAutoOff = storage.loadAutoOffState();
const autoOffState = {};

// Initialize autoOffState with persisted data, adding runtime-only fields
Object.keys(persistedAutoOff).forEach(chargerId => {
  autoOffState[chargerId] = {
    enabled: persistedAutoOff[chargerId].enabled,
    completionDetectedAt: null,  // Runtime-only
    revalidationTimer: null      // Runtime-only
  };
});

/**
 * Enable auto-off for a charger
 * @param {string} chargerId - The charger ID
 */
function enableAutoOff(chargerId) {
  if (!autoOffState[chargerId]) {
    autoOffState[chargerId] = {
      enabled: true,
      completionDetectedAt: null,
      revalidationTimer: null
    };
  } else {
    autoOffState[chargerId].enabled = true;
  }
  console.log(`Auto-off enabled for charger ${chargerId}`);
  
  // Persist the auto-off state
  storage.saveAutoOffState(autoOffState);
}

/**
 * Disable auto-off for a charger and clear any pending timers
 * @param {string} chargerId - The charger ID
 */
function disableAutoOff(chargerId) {
  if (autoOffState[chargerId]) {
    autoOffState[chargerId].enabled = false;
    if (autoOffState[chargerId].revalidationTimer) {
      clearTimeout(autoOffState[chargerId].revalidationTimer);
      autoOffState[chargerId].revalidationTimer = null;
    }
    autoOffState[chargerId].completionDetectedAt = null;
  }
  console.log(`Auto-off disabled for charger ${chargerId}`);
  
  // Persist the auto-off state
  storage.saveAutoOffState(autoOffState);
}

/**
 * Turn off charger via MQTT
 * @param {string} chargerId - The charger ID
 */
function turnOffCharger(chargerId) {
  const chargerState = chargerStates[chargerId];
  if (!chargerState) {
    console.error(`Cannot turn off charger ${chargerId}: charger not found`);
    return;
  }

  if (!mqttClient || !mqttClient.connected) {
    console.error(`Cannot turn off charger ${chargerId}: MQTT not connected`);
    return;
  }

  const commandTopic = `${chargerState.topic}/relay/0/command`;
  const command = 'off';

  console.log(`Auto-off: Sending OFF command to charger "${chargerState.name}" (${chargerId})`);

  mqttClient.publish(commandTopic, command, { qos: 1, retain: false }, (err) => {
    if (err) {
      console.error(`Auto-off: Failed to send OFF command to ${commandTopic}:`, err);
    } else {
      console.log(`Auto-off: Successfully sent OFF command to charger "${chargerState.name}"`);
    }
  });
}

/**
 * Check and handle auto-off for a charger
 * Called periodically to check if completion criteria are met
 * @param {string} chargerId - The charger ID
 */
function checkAutoOff(chargerId) {
  const autoOff = autoOffState[chargerId];
  const chargerState = chargerStates[chargerId];

  // Skip if auto-off not enabled or charger not found
  if (!autoOff || !autoOff.enabled || !chargerState) {
    return;
  }

  // Skip if charger is off or no active process
  if (!chargerState.isOn || chargerState.currentProcessId === null) {
    // Clear any pending timers if charger is off
    if (autoOff.revalidationTimer) {
      clearTimeout(autoOff.revalidationTimer);
      autoOff.revalidationTimer = null;
      autoOff.completionDetectedAt = null;
    }
    return;
  }

  const process = chargingProcesses.find(p => p.id === chargerState.currentProcessId);
  if (!process || process.endTime) {
    return;
  }

  // Check if in completion phase
  const isCompleting = patternAnalyzer.isInCompletionPhase(process);

  if (isCompleting) {
    const now = Date.now();

    if (!autoOff.completionDetectedAt) {
      // First time detecting completion - start the timer
      autoOff.completionDetectedAt = now;
      console.log(`Auto-off: Completion detected for charger ${chargerId}, starting ${AUTO_OFF_DELAY_MS / 60000}-minute timer`);

      // Set timer for revalidation after configured delay
      autoOff.revalidationTimer = setTimeout(() => {
        console.log(`Auto-off: ${AUTO_OFF_DELAY_MS / 60000}-minute timer expired for charger ${chargerId}, revalidating...`);
        
        // Revalidate completion state
        const currentProcess = chargingProcesses.find(p => p.id === chargerState.currentProcessId);
        if (currentProcess && !currentProcess.endTime) {
          const stillCompleting = patternAnalyzer.isInCompletionPhase(currentProcess);
          
          if (stillCompleting) {
            console.log(`Auto-off: Revalidation confirmed completion for charger ${chargerId}, turning off`);
            turnOffCharger(chargerId);
            // Reset state
            autoOff.completionDetectedAt = null;
            autoOff.revalidationTimer = null;
          } else {
            console.log(`Auto-off: Revalidation showed charging resumed for charger ${chargerId}, timer reset`);
            autoOff.completionDetectedAt = null;
            autoOff.revalidationTimer = null;
          }
        } else {
          console.log(`Auto-off: Process ended or not found for charger ${chargerId}, clearing timer`);
          autoOff.completionDetectedAt = null;
          autoOff.revalidationTimer = null;
        }
      }, AUTO_OFF_DELAY_MS);
    }
  } else {
    // Not in completion phase - clear any pending timer
    if (autoOff.completionDetectedAt) {
      console.log(`Auto-off: Charging resumed for charger ${chargerId}, clearing completion timer`);
      if (autoOff.revalidationTimer) {
        clearTimeout(autoOff.revalidationTimer);
        autoOff.revalidationTimer = null;
      }
      autoOff.completionDetectedAt = null;
    }
  }
}

// Check auto-off for all chargers periodically
const autoOffCheckInterval = setInterval(() => {
  Object.keys(chargerStates).forEach(chargerId => {
    checkAutoOff(chargerId);
  });
}, AUTO_OFF_CHECK_INTERVAL_MS);

// ─── Appliance cycle detection ────────────────────────────────────────────────

/**
 * Start a new appliance cycle
 * @param {string} applianceId - The appliance ID
 * @param {string} timestamp - ISO timestamp
 */
function startApplianceCycle(applianceId, timestamp) {
  const appliance = applianceStates[applianceId];
  if (!appliance || appliance.isRunning) return;

  const processId = processIdCounter++;
  const newProcess = {
    id: processId,
    applianceId: applianceId,
    applianceName: appliance.name,
    processType: 'appliance',
    startTime: timestamp,
    endTime: null,
    events: [
      { timestamp, type: 'cycle_start', value: appliance.power }
    ]
  };

  chargingProcesses.push(newProcess);
  appliance.currentProcessId = processId;
  appliance.isRunning = true;

  storage.saveProcesses(chargingProcesses);
  storage.saveProcessCounter(processIdCounter);

  console.log(`Appliance "${appliance.name}" (${applianceId}): cycle started (process ${processId})`);
}

/**
 * Publish an MQTT notification when an appliance cycle completes
 * @param {string} applianceId - The appliance ID
 * @param {Object} process - The completed process
 */
function publishCycleCompleteNotification(applianceId, process) {
  const appliance = applianceStates[applianceId];
  if (!appliance) return;

  if (!mqttClient || !mqttClient.connected) {
    console.error(`Appliance "${appliance.name}": Cannot send cycle-complete notification - MQTT not connected`);
    return;
  }

  const durationMs = process.endTime
    ? new Date(process.endTime).getTime() - new Date(process.startTime).getTime()
    : 0;
  const durationMinutes = parseFloat((durationMs / 1000 / 60).toFixed(1));

  const payload = JSON.stringify({
    event: 'cycle_complete',
    applianceName: appliance.name,
    applianceId: applianceId,
    processId: process.id,
    startTime: process.startTime,
    endTime: process.endTime,
    durationMinutes: durationMinutes
  });

  console.log(`Appliance "${appliance.name}": publishing cycle-complete notification to ${appliance.notifyTopic}`);

  mqttClient.publish(appliance.notifyTopic, payload, { qos: 1, retain: false }, (err) => {
    if (err) {
      console.error(`Appliance "${appliance.name}": Failed to publish cycle-complete notification:`, err);
    } else {
      console.log(`Appliance "${appliance.name}": cycle-complete notification sent successfully`);
    }
  });
}

/**
 * End an appliance cycle and publish the cycle-complete MQTT notification
 * @param {string} applianceId - The appliance ID
 */
function endApplianceCycle(applianceId) {
  const appliance = applianceStates[applianceId];
  if (!appliance || !appliance.isRunning) return;

  const processId = appliance.currentProcessId;
  const process = chargingProcesses.find(p => p.id === processId);
  const timestamp = new Date().toISOString();

  if (process && !process.endTime) {
    process.endTime = timestamp;
    process.events.push({ timestamp, type: 'cycle_end', value: appliance.power });
    storage.saveProcesses(chargingProcesses);
    console.log(`Appliance "${appliance.name}" (${applianceId}): cycle ended (process ${processId})`);

    publishCycleCompleteNotification(applianceId, process);
  }

  appliance.isRunning = false;
  appliance.currentProcessId = null;
  appliance.cycleEndDetectedAt = null;
  if (appliance.cycleEndTimer) {
    clearTimeout(appliance.cycleEndTimer);
    appliance.cycleEndTimer = null;
  }
}

/**
 * Check whether an appliance cycle should end (power sustained below threshold)
 * Called periodically via applianceCycleCheckInterval
 * @param {string} applianceId - The appliance ID
 */
function checkApplianceCycleEnd(applianceId) {
  const appliance = applianceStates[applianceId];

  if (!appliance || !appliance.isRunning || appliance.currentProcessId === null) {
    return;
  }

  const process = chargingProcesses.find(p => p.id === appliance.currentProcessId);
  if (!process || process.endTime) {
    return;
  }

  const powerIsLow = appliance.power < APPLIANCE_END_THRESHOLD_W;

  if (powerIsLow) {
    if (!appliance.cycleEndDetectedAt) {
      // First time detecting low power – start the stable-period timer
      appliance.cycleEndDetectedAt = Date.now();
      console.log(`Appliance "${appliance.name}": low power detected (<${APPLIANCE_END_THRESHOLD_W}W), starting ${APPLIANCE_END_STABLE_MS / 60000}-minute end timer`);

      appliance.cycleEndTimer = setTimeout(() => {
        const current = applianceStates[applianceId];
        if (current && current.isRunning && current.power < APPLIANCE_END_THRESHOLD_W) {
          console.log(`Appliance "${appliance.name}": confirmed cycle end after stable low-power period`);
          endApplianceCycle(applianceId);
        } else {
          console.log(`Appliance "${appliance.name}": power back above threshold during end timer – resetting`);
          if (current) {
            current.cycleEndDetectedAt = null;
            current.cycleEndTimer = null;
          }
        }
      }, APPLIANCE_END_STABLE_MS);
    }
  } else {
    // Power is above threshold again – cancel any pending end timer
    if (appliance.cycleEndDetectedAt) {
      console.log(`Appliance "${appliance.name}": power back above threshold, cancelling end timer`);
      if (appliance.cycleEndTimer) {
        clearTimeout(appliance.cycleEndTimer);
        appliance.cycleEndTimer = null;
      }
      appliance.cycleEndDetectedAt = null;
    }
  }
}

// Check appliance cycle end for all appliances periodically
const applianceCycleCheckInterval = setInterval(() => {
  Object.keys(applianceStates).forEach(applianceId => {
    checkApplianceCycleEnd(applianceId);
  });
}, APPLIANCE_CHECK_INTERVAL_MS);

// ──────────────────────────────────────────────────────────────────────────────

// Cleanup on shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, cleaning up...');
  if (autoOffCheckInterval) {
    clearInterval(autoOffCheckInterval);
  }
  if (applianceCycleCheckInterval) {
    clearInterval(applianceCycleCheckInterval);
  }
  // Clear all auto-off timers
  Object.keys(autoOffState).forEach(chargerId => {
    disableAutoOff(chargerId);
  });
  // Clear all appliance end timers
  Object.keys(applianceStates).forEach(applianceId => {
    const appliance = applianceStates[applianceId];
    if (appliance && appliance.cycleEndTimer) {
      clearTimeout(appliance.cycleEndTimer);
      appliance.cycleEndTimer = null;
    }
  });
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, cleaning up...');
  if (autoOffCheckInterval) {
    clearInterval(autoOffCheckInterval);
  }
  if (applianceCycleCheckInterval) {
    clearInterval(applianceCycleCheckInterval);
  }
  // Clear all auto-off timers
  Object.keys(autoOffState).forEach(chargerId => {
    disableAutoOff(chargerId);
  });
  // Clear all appliance end timers
  Object.keys(applianceStates).forEach(applianceId => {
    const appliance = applianceStates[applianceId];
    if (appliance && appliance.cycleEndTimer) {
      clearTimeout(appliance.cycleEndTimer);
      appliance.cycleEndTimer = null;
    }
  });
  process.exit(0);
});

// MQTT Configuration
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
const MQTT_USERNAME = process.env.MQTT_USERNAME || '';
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || '';

// Parse charger configurations (for physical charging devices like ShellyPlugs)
// New format: "Name:topic,Name2:topic2" (e.g., "Office Charger:shellies/shellyplug07")
// Legacy format: "chargerId,chargerId2" (backward compatible)
const parseChargerConfig = (configString) => {
  if (!configString) return [];
  
  return configString.split(',').map(item => {
    const trimmed = item.trim();
    if (trimmed.includes(':')) {
      // New format: name:topic
      const [name, topic] = trimmed.split(':').map(s => s.trim());
      return { name, topic, id: topic.replace(/\//g, '_') };
    } else {
      // Legacy format: just charger ID (topic = chargerId)
      return { name: trimmed, topic: trimmed, id: trimmed };
    }
  });
};

const MQTT_CHARGERS = parseChargerConfig(process.env.MQTT_DEVICES);

const MQTT_APPLIANCES = parseApplianceConfig(process.env.MQTT_APPLIANCES);

console.log('Starting backend server...');
console.log('MQTT Broker:', MQTT_BROKER_URL);
console.log('Configured chargers:', MQTT_CHARGERS.map(d => `${d.name} (${d.topic})`).join(', '));
console.log('Configured appliances:', MQTT_APPLIANCES.length
  ? MQTT_APPLIANCES.map(a => `${a.name} (${a.topic}) → notify: ${a.notifyTopic}`).join(', ')
  : '(none)');

// MQTT Client setup
const mqttOptions = {
  clean: true,
  connectTimeout: 4000,
};

if (MQTT_USERNAME) {
  mqttOptions.username = MQTT_USERNAME;
}

if (MQTT_PASSWORD) {
  mqttOptions.password = MQTT_PASSWORD;
}

const mqttClient = mqtt.connect(MQTT_BROKER_URL, mqttOptions);

// Subscribe to topics for all configured chargers
mqttClient.on('connect', () => {
  console.log('Connected to MQTT broker');
  
  MQTT_CHARGERS.forEach(charger => {
    // Subscribe to power on/off topic
    const powerTopic = `${charger.topic}/relay/0`;
    mqttClient.subscribe(powerTopic, (err) => {
      if (err) {
        console.error(`Failed to subscribe to ${powerTopic}:`, err);
      } else {
        console.log(`Subscribed to ${powerTopic} for charger "${charger.name}"`);
      }
    });
    
    // Subscribe to power consumption topic
    const consumptionTopic = `${charger.topic}/relay/0/power`;
    mqttClient.subscribe(consumptionTopic, (err) => {
      if (err) {
        console.error(`Failed to subscribe to ${consumptionTopic}:`, err);
      } else {
        console.log(`Subscribed to ${consumptionTopic} for charger "${charger.name}"`);
      }
    });
    
    // Initialize charger state with unique ID and name
    chargerStates[charger.id] = {
      name: charger.name,
      topic: charger.topic,
      isOn: false,
      power: 0,
      currentProcessId: null
    };
  });

  // Subscribe to power topics for all configured appliances
  MQTT_APPLIANCES.forEach(appliance => {
    const powerTopic = `${appliance.topic}/relay/0/power`;
    mqttClient.subscribe(powerTopic, (err) => {
      if (err) {
        console.error(`Failed to subscribe to ${powerTopic}:`, err);
      } else {
        console.log(`Subscribed to ${powerTopic} for appliance "${appliance.name}"`);
      }
    });

    // Initialize appliance state
    applianceStates[appliance.id] = {
      name: appliance.name,
      topic: appliance.topic,
      notifyTopic: appliance.notifyTopic,
      power: 0,
      isRunning: false,
      currentProcessId: null,
      cycleEndDetectedAt: null,
      cycleEndTimer: null
    };
  });
});

mqttClient.on('error', (error) => {
  console.error('MQTT connection error:', error);
});

mqttClient.on('message', (topic, message) => {
  const timestamp = new Date().toISOString();
  const messageStr = message.toString();
  
  console.log(`Received message on ${topic}: ${messageStr}`);
  
  // Find charger by matching topic prefix
  let chargerId = null;
  let chargerConfig = null;
  
  for (const [id, state] of Object.entries(chargerStates)) {
    if (topic.startsWith(state.topic + '/')) {
      chargerId = id;
      chargerConfig = state;
      break;
    }
  }

  // Find appliance by matching topic prefix
  let applianceId = null;
  for (const [id, state] of Object.entries(applianceStates)) {
    if (topic.startsWith(state.topic + '/')) {
      applianceId = id;
      break;
    }
  }
  
  if (!chargerId && !applianceId) {
    console.warn(`Received message for unknown charger or appliance on topic: ${topic}`);
    return;
  }
  
  // Handle power on/off messages (chargers only)
  if (chargerId && topic.endsWith('/relay/0')) {
    const isOn = messageStr.toLowerCase() === 'on' || messageStr === '1' || messageStr === 'true';
    
    if (isOn && !chargerStates[chargerId].isOn) {
      // Start new charging process
      const processId = processIdCounter++;
      const newProcess = {
        id: processId,
        deviceId: chargerId, // Backward compatibility: keep old field name
        chargerId: chargerId,
        deviceName: chargerConfig.name, // Backward compatibility: this was the charger name
        chargerName: chargerConfig.name,
        startTime: timestamp,
        endTime: null,
        events: [
          {
            timestamp: timestamp,
            type: 'power_on',
            value: true
          }
        ]
      };
      
      chargingProcesses.push(newProcess);
      chargerStates[chargerId].currentProcessId = processId;
      chargerStates[chargerId].isOn = true;
      
      // Persist to storage
      storage.saveProcesses(chargingProcesses);
      storage.saveProcessCounter(processIdCounter);
      
      console.log(`Started charging process ${processId} on charger "${chargerConfig.name}"`);
    } else if (!isOn && chargerStates[chargerId].isOn) {
      // End current charging process
      const processId = chargerStates[chargerId].currentProcessId;
      const process = chargingProcesses.find(p => p.id === processId);
      
      if (process) {
        process.endTime = timestamp;
        process.events.push({
          timestamp: timestamp,
          type: 'power_off',
          value: false
        });
        
        // Check if there's a high-confidence pattern match and auto-assign device name
        tryAutoAssignDeviceName(process, processId);
        
        // Persist to storage
        storage.saveProcesses(chargingProcesses);
        
        console.log(`Ended charging process ${processId} on charger "${chargerConfig.name}"`);
      }
      
      chargerStates[chargerId].isOn = false;
      chargerStates[chargerId].currentProcessId = null;
    }
  }
  
  // Handle power consumption messages (chargers)
  if (chargerId && topic.endsWith('/power')) {
    const power = parseFloat(messageStr);
    
    if (!isNaN(power)) {
      chargerStates[chargerId].power = power;
      
      // Add to current process if one is active
      const processId = chargerStates[chargerId].currentProcessId;
      if (processId !== null) {
        const process = chargingProcesses.find(p => p.id === processId);
        if (process) {
          process.events.push({
            timestamp: timestamp,
            type: 'power_consumption',
            value: power
          });
          
          // Schedule a throttled save
          scheduleSave();
        }
      }
    }
  }

  // Handle power messages for appliances (cycle detection based on power threshold)
  if (applianceId && topic.endsWith('/power')) {
    const power = parseFloat(messageStr);

    if (!isNaN(power)) {
      applianceStates[applianceId].power = power;

      // Detect cycle start: power exceeds threshold while no cycle is running
      if (!applianceStates[applianceId].isRunning && power >= APPLIANCE_START_THRESHOLD_W) {
        startApplianceCycle(applianceId, timestamp);
      }

      // Record power consumption event while a cycle is running
      if (applianceStates[applianceId].isRunning) {
        const processId = applianceStates[applianceId].currentProcessId;
        if (processId !== null) {
          const process = chargingProcesses.find(p => p.id === processId);
          if (process) {
            process.events.push({
              timestamp: timestamp,
              type: 'power_consumption',
              value: power
            });
            scheduleSave();
          }
        }
      }
    }
  }
});

// API Routes

// Get all charging processes
app.get('/api/processes', (req, res) => {
  res.json(chargingProcesses);
});

// Get charging processes for a specific charger
app.get('/api/processes/charger/:chargerId', (req, res) => {
  const { chargerId } = req.params;
  // Check both fields for backward compatibility
  const chargerProcesses = chargingProcesses.filter(p => 
    p.chargerId === chargerId || p.deviceId === chargerId
  );
  res.json(chargerProcesses);
});

// Backward compatibility: old endpoint name
app.get('/api/processes/device/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  // Check both fields for backward compatibility
  const chargerProcesses = chargingProcesses.filter(p => 
    p.chargerId === deviceId || p.deviceId === deviceId
  );
  res.json(chargerProcesses);
});

// Get active (incomplete) processes for a specific charger
app.get('/api/chargers/:chargerId/active-processes', (req, res) => {
  const { chargerId } = req.params;
  // Check both fields for backward compatibility
  const activeProcesses = chargingProcesses.filter(p => 
    (p.chargerId === chargerId || p.deviceId === chargerId) && p.endTime === null
  );
  res.json(activeProcesses);
});

// Backward compatibility: old endpoint name
app.get('/api/devices/:deviceId/active-processes', (req, res) => {
  const { deviceId } = req.params;
  // Check both fields for backward compatibility
  const activeProcesses = chargingProcesses.filter(p => 
    (p.chargerId === deviceId || p.deviceId === deviceId) && p.endTime === null
  );
  res.json(activeProcesses);
});

// Get a specific charging process
app.get('/api/processes/:id', (req, res) => {
  const processId = parseInt(req.params.id);
  const process = chargingProcesses.find(p => p.id === processId);
  
  if (process) {
    res.json(process);
  } else {
    res.status(404).json({ error: 'Process not found' });
  }
});

// Delete a charging process
app.delete('/api/processes/:id', (req, res) => {
  const processId = parseInt(req.params.id);
  
  // Validate that the ID is a valid number
  if (isNaN(processId)) {
    return res.status(400).json({ error: 'Invalid process ID' });
  }
  
  const processIndex = chargingProcesses.findIndex(p => p.id === processId);
  
  if (processIndex === -1) {
    return res.status(404).json({ error: 'Process not found' });
  }
  
  // Remove the process from the array
  chargingProcesses.splice(processIndex, 1);
  
  // Persist the change to storage
  storage.saveProcesses(chargingProcesses);
  
  console.log(`Deleted charging process ${processId}`);
  res.json({ success: true, message: 'Process deleted successfully' });
});

// Mark a charging process as complete (manually set endTime)
app.put('/api/processes/:id/complete', (req, res) => {
  const processId = parseInt(req.params.id);
  
  // Validate that the ID is a valid number
  if (isNaN(processId)) {
    return res.status(400).json({ error: 'Invalid process ID' });
  }
  
  const process = chargingProcesses.find(p => p.id === processId);
  
  if (!process) {
    return res.status(404).json({ error: 'Process not found' });
  }
  
  // Check if process is already completed
  if (process.endTime !== null) {
    return res.status(400).json({ error: 'Process is already completed' });
  }
  
  // Mark the process as complete with current timestamp
  const timestamp = new Date().toISOString();
  process.endTime = timestamp;
  process.events.push({
    timestamp: timestamp,
    type: 'manual_completion',
    value: false
  });
  
  // Clear current process reference if this charger is tracking it
  const chargerState = Object.values(chargerStates).find(
    state => state.currentProcessId === processId
  );
  if (chargerState) {
    chargerState.isOn = false;
    chargerState.currentProcessId = null;
  }
  
  // Check if there's a high-confidence pattern match and auto-assign device name
  tryAutoAssignDeviceName(process, processId);
  
  // Persist the change to storage
  storage.saveProcesses(chargingProcesses);
  
  console.log(`Manually completed charging process ${processId}`);
  
  res.json({ success: true, message: 'Process marked as complete', process });
});

// Update device name for a single process
// This can split a pattern if the process is being renamed differently from its pattern
app.put('/api/processes/:id/device-name', (req, res) => {
  const processId = parseInt(req.params.id);
  const { newDeviceName } = req.body;
  
  // Validate that the ID is a valid number
  if (Number.isNaN(processId) || !Number.isInteger(processId)) {
    return res.status(400).json({ error: 'Invalid process ID' });
  }
  
  if (!newDeviceName || typeof newDeviceName !== 'string' || newDeviceName.trim() === '') {
    return res.status(400).json({ error: 'Invalid device name' });
  }
  
  const process = chargingProcesses.find(p => p.id === processId);
  
  if (!process) {
    return res.status(404).json({ error: 'Process not found' });
  }
  
  const trimmedName = newDeviceName.trim();
  const oldDeviceName = process.deviceName;
  
  // Update the process's device name
  process.deviceName = trimmedName;
  storage.saveProcesses(chargingProcesses);
  
  // Find the pattern that currently contains this process
  const currentPattern = chargingPatterns.find(pattern => 
    pattern.processIds && pattern.processIds.includes(processId)
  );
  
  if (currentPattern) {
    // Remove this process from the current pattern
    currentPattern.processIds = currentPattern.processIds.filter(id => id !== processId);
    currentPattern.count = currentPattern.processIds.length;
    
    // If the pattern is now empty, remove it
    if (currentPattern.count === 0) {
      const patternIndex = chargingPatterns.findIndex(p => p.id === currentPattern.id);
      if (patternIndex !== -1) {
        chargingPatterns.splice(patternIndex, 1);
        console.log(`Removed empty pattern ${currentPattern.id}`);
      }
    }
    
    // Check if there's an existing pattern with the new device name
    const targetPattern = chargingPatterns.find(p => p.deviceName === trimmedName);
    
    if (targetPattern) {
      // Add this process to the existing pattern
      if (!targetPattern.processIds.includes(processId)) {
        targetPattern.processIds.push(processId);
        targetPattern.count = targetPattern.processIds.length;
        targetPattern.lastSeen = process.endTime || new Date().toISOString();
        console.log(`Added process ${processId} to existing pattern ${targetPattern.id}`);
      }
    } else {
      // Pattern doesn't exist - return error since we don't auto-create patterns
      // The user must create a pattern manually first via POST /api/patterns
      return res.status(404).json({ 
        error: 'No pattern exists with this device name',
        message: 'Please create a pattern with this name first, or choose an existing pattern name',
        deviceName: trimmedName
      });
    }
    
    // Save updated patterns
    patternAnalyzer.savePatterns(chargingPatterns);
  }
  
  console.log(`Updated process ${processId} device name from "${oldDeviceName}" to "${trimmedName}"`);
  
  res.json({
    success: true,
    message: 'Process device name updated',
    processId,
    oldDeviceName,
    newDeviceName: trimmedName
  });
});

// Get current charger states
app.get('/api/chargers', (req, res) => {
  const chargers = Object.entries(chargerStates).map(([id, state]) => {
    const autoOff = autoOffState[id];
    return {
      id,
      name: state.name,
      topic: state.topic,
      isOn: state.isOn,
      power: state.power,
      currentProcessId: state.currentProcessId,
      autoOffEnabled: autoOff ? autoOff.enabled : false
    };
  });
  
  res.json(chargers);
});

// Backward compatibility: old endpoint name
app.get('/api/devices', (req, res) => {
  const chargers = Object.entries(chargerStates).map(([id, state]) => {
    const autoOff = autoOffState[id];
    return {
      id,
      name: state.name,
      topic: state.topic,
      isOn: state.isOn,
      power: state.power,
      currentProcessId: state.currentProcessId,
      autoOffEnabled: autoOff ? autoOff.enabled : false
    };
  });
  
  res.json(chargers);
});

// Get state of a specific charger
app.get('/api/chargers/:chargerId', (req, res) => {
  const { chargerId } = req.params;
  const state = chargerStates[chargerId];
  
  if (state) {
    const autoOff = autoOffState[chargerId];
    res.json({
      id: chargerId,
      name: state.name,
      topic: state.topic,
      isOn: state.isOn,
      power: state.power,
      currentProcessId: state.currentProcessId,
      autoOffEnabled: autoOff ? autoOff.enabled : false
    });
  } else {
    res.status(404).json({ error: 'Charger not found' });
  }
});

// Backward compatibility: old endpoint name
app.get('/api/devices/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  const state = chargerStates[deviceId];
  
  if (state) {
    const autoOff = autoOffState[deviceId];
    res.json({
      id: deviceId,
      name: state.name,
      topic: state.topic,
      isOn: state.isOn,
      power: state.power,
      currentProcessId: state.currentProcessId,
      autoOffEnabled: autoOff ? autoOff.enabled : false
    });
  } else {
    res.status(404).json({ error: 'Device not found' });
  }
});

// Control charger endpoint - turn on/off
app.post('/api/chargers/:chargerId/control', (req, res) => {
  const { chargerId } = req.params;
  const { state } = req.body;
  
  // Validate charger exists
  const chargerState = chargerStates[chargerId];
  if (!chargerState) {
    return res.status(404).json({ error: 'Charger not found' });
  }
  
  // Validate state parameter
  if (!state || (state !== 'on' && state !== 'off')) {
    return res.status(400).json({ error: 'Invalid state. Must be "on" or "off"' });
  }
  
  // Check if MQTT is connected
  if (!mqttClient || !mqttClient.connected) {
    return res.status(503).json({ error: 'MQTT broker not connected' });
  }
  
  // Publish command to MQTT
  const commandTopic = `${chargerState.topic}/relay/0/command`;
  const command = state;
  
  console.log(`Sending command to charger "${chargerState.name}" (${chargerId}): ${command} on topic ${commandTopic}`);
  
  mqttClient.publish(commandTopic, command, { qos: 1, retain: false }, (err) => {
    if (err) {
      console.error(`Failed to publish command to ${commandTopic}:`, err);
      return res.status(500).json({ error: 'Failed to send command to charger' });
    }
    
    console.log(`Successfully sent ${command} command to charger "${chargerState.name}"`);
    res.json({
      success: true,
      message: `Command "${command}" sent to charger "${chargerState.name}"`,
      chargerId: chargerId,
      chargerName: chargerState.name,
      commandSent: command
    });
  });
});

// Enable auto-off for a charger
app.post('/api/chargers/:chargerId/auto-off/enable', (req, res) => {
  const { chargerId } = req.params;
  
  const chargerState = chargerStates[chargerId];
  if (!chargerState) {
    return res.status(404).json({ error: 'Charger not found' });
  }
  
  enableAutoOff(chargerId);
  
  res.json({
    success: true,
    message: `Auto-off enabled for charger "${chargerState.name}"`,
    chargerId: chargerId,
    chargerName: chargerState.name,
    autoOffEnabled: true
  });
});

// Disable auto-off for a charger
app.post('/api/chargers/:chargerId/auto-off/disable', (req, res) => {
  const { chargerId } = req.params;
  
  const chargerState = chargerStates[chargerId];
  if (!chargerState) {
    return res.status(404).json({ error: 'Charger not found' });
  }
  
  disableAutoOff(chargerId);
  
  res.json({
    success: true,
    message: `Auto-off disabled for charger "${chargerState.name}"`,
    chargerId: chargerId,
    chargerName: chargerState.name,
    autoOffEnabled: false
  });
});

// Get auto-off status for a charger
app.get('/api/chargers/:chargerId/auto-off/status', (req, res) => {
  const { chargerId } = req.params;
  
  const chargerState = chargerStates[chargerId];
  if (!chargerState) {
    return res.status(404).json({ error: 'Charger not found' });
  }
  
  const autoOff = autoOffState[chargerId];
  const enabled = autoOff ? autoOff.enabled : false;
  const completionDetected = autoOff && autoOff.completionDetectedAt !== null;
  const timeUntilShutoff = completionDetected 
    ? Math.max(0, Math.round((AUTO_OFF_DELAY_MS - (Date.now() - autoOff.completionDetectedAt)) / 1000))
    : null;
  
  res.json({
    chargerId: chargerId,
    chargerName: chargerState.name,
    autoOffEnabled: enabled,
    completionDetected: completionDetected,
    timeUntilShutoffSeconds: timeUntilShutoff
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mqttConnected: mqttClient.connected,
    chargers: MQTT_CHARGERS,
    appliances: MQTT_APPLIANCES,
    timestamp: new Date().toISOString()
  });
});

// Appliance Monitoring Endpoints

// Get all appliance states
app.get('/api/appliances', (req, res) => {
  const appliances = Object.entries(applianceStates).map(([id, state]) => ({
    id,
    name: state.name,
    topic: state.topic,
    notifyTopic: state.notifyTopic,
    power: state.power,
    isRunning: state.isRunning,
    currentProcessId: state.currentProcessId
  }));
  res.json(appliances);
});

// Get state of a specific appliance
app.get('/api/appliances/:applianceId', (req, res) => {
  const { applianceId } = req.params;
  const state = applianceStates[applianceId];

  if (!state) {
    return res.status(404).json({ error: 'Appliance not found' });
  }

  res.json({
    id: applianceId,
    name: state.name,
    topic: state.topic,
    notifyTopic: state.notifyTopic,
    power: state.power,
    isRunning: state.isRunning,
    currentProcessId: state.currentProcessId
  });
});

// Get active process for a specific appliance
app.get('/api/appliances/:applianceId/active-process', (req, res) => {
  const { applianceId } = req.params;
  const state = applianceStates[applianceId];

  if (!state) {
    return res.status(404).json({ error: 'Appliance not found' });
  }

  if (!state.currentProcessId) {
    return res.json({ applianceId, isRunning: false, process: null });
  }

  const process = chargingProcesses.find(p => p.id === state.currentProcessId);
  res.json({ applianceId, isRunning: state.isRunning, process: process || null });
});

// Get all processes (cycles) for a specific appliance
app.get('/api/appliances/:applianceId/processes', (req, res) => {
  const { applianceId } = req.params;

  if (!applianceStates[applianceId]) {
    return res.status(404).json({ error: 'Appliance not found' });
  }

  const processes = chargingProcesses.filter(p => p.applianceId === applianceId);
  res.json(processes);
});

// Pattern Analysis Endpoints

// Get all identified charging patterns
app.get('/api/patterns', (req, res) => {
  res.json(chargingPatterns);
});

// Get patterns for a specific charger
app.get('/api/patterns/charger/:chargerId', (req, res) => {
  const { chargerId } = req.params;
  // Check both fields for backward compatibility
  const chargerPatterns = chargingPatterns.filter(p => 
    p.chargerId === chargerId || p.deviceId === chargerId
  );
  res.json(chargerPatterns);
});

// Backward compatibility: old endpoint name
app.get('/api/patterns/device/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  // Check both fields for backward compatibility
  const chargerPatterns = chargingPatterns.filter(p => 
    p.chargerId === deviceId || p.deviceId === deviceId
  );
  res.json(chargerPatterns);
});

// Trigger pattern analysis manually
app.post('/api/patterns/analyze', async (req, res) => {
  try {
    console.log('Manual pattern analysis triggered via API');
    await runPatternAnalysis();
    res.json({ 
      success: true, 
      message: 'Pattern analysis completed',
      patternsFound: chargingPatterns.length,
      totalProcesses: chargingProcesses.length,
      completedProcesses: chargingProcesses.filter(p => p.endTime).length
    });
  } catch (error) {
    console.error('Error running pattern analysis:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to run pattern analysis' 
    });
  }
});

// Rerun pattern recognition - clears all patterns and reanalyzes from scratch
app.post('/api/patterns/rerun', async (req, res) => {
  try {
    console.log('Rerun pattern recognition triggered via API');
    
    // Clear all existing patterns - this will cause all patterns to be recreated
    chargingPatterns = [];
    
    // Run pattern analysis from scratch
    // This will create new patterns based on all completed processes
    await runPatternAnalysis();
    
    res.json({ 
      success: true, 
      message: 'Pattern recognition rerun completed',
      patternsFound: chargingPatterns.length,
      totalProcesses: chargingProcesses.length,
      completedProcesses: chargingProcesses.filter(p => p.endTime).length
    });
  } catch (error) {
    console.error('Error rerunning pattern recognition:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to rerun pattern recognition' 
    });
  }
});

// Get pattern match for a specific process
app.get('/api/processes/:id/pattern', (req, res) => {
  const processId = parseInt(req.params.id);
  
  // Validate that the ID is a valid number
  if (isNaN(processId)) {
    return res.status(400).json({ error: 'Invalid process ID' });
  }
  
  const process = chargingProcesses.find(p => p.id === processId);
  
  if (!process) {
    return res.status(404).json({ error: 'Process not found' });
  }
  
  const match = patternAnalyzer.findMatchingPattern(process, chargingPatterns);
  
  if (match) {
    res.json({
      processId: processId,
      matchFound: true,
      pattern: match.pattern,
      similarity: match.similarity
    });
  } else {
    res.json({
      processId: processId,
      matchFound: false,
      message: 'No matching pattern found'
    });
  }
});

// Diagnostic endpoint to help troubleshoot pattern recognition
app.get('/api/patterns/debug', (req, res) => {
  const completedProcesses = chargingProcesses.filter(p => p.endTime);
  const processesWithPowerData = completedProcesses.filter(p => 
    p.events.some(e => e.type === 'power_consumption')
  );
  
  const processDetails = processesWithPowerData.map(p => {
    const powerEvents = p.events.filter(e => e.type === 'power_consumption' && e.value > 0);
    const profile = patternAnalyzer.calculatePowerProfile(p);
    const matchingPattern = chargingPatterns.find(pattern => 
      pattern.processIds && pattern.processIds.includes(p.id)
    );
    
    return {
      id: p.id,
      chargerName: p.chargerName || p.deviceName || p.chargerId || p.deviceId,
      deviceName: 'Unknown', // Will be set if pattern matches
      completed: !!p.endTime,
      powerEventsCount: powerEvents.length,
      hasProfile: profile !== null,
      hasPattern: !!matchingPattern,
      patternId: matchingPattern?.id,
      duration: p.endTime ? (new Date(p.endTime) - new Date(p.startTime)) / 1000 / 60 : null
    };
  });
  
  res.json({
    totalProcesses: chargingProcesses.length,
    completedProcesses: completedProcesses.length,
    processesWithPowerData: processesWithPowerData.length,
    totalPatterns: chargingPatterns.length,
    processDetails: processDetails
  });
});

// Educated guess endpoint for active processes
// Returns likely device matches based on current power consumption profile
// Does NOT store anything or affect patterns - just provides real-time suggestions
app.get('/api/processes/:id/guess', (req, res) => {
  const processId = parseInt(req.params.id);
  
  // Validate that the ID is a valid positive integer
  if (isNaN(processId) || processId <= 0 || !Number.isInteger(processId)) {
    return res.status(400).json({ error: 'Invalid process ID' });
  }
  
  const process = chargingProcesses.find(p => p.id === processId);
  
  if (!process) {
    return res.status(404).json({ error: 'Process not found' });
  }
  
  // Only provide guesses for active (incomplete) processes
  if (process.endTime) {
    return res.json({
      processId: processId,
      isActive: false,
      message: 'Process is completed, no guess needed'
    });
  }
  
  // Don't provide guesses if the device name is already assigned
  if (process.deviceName && process.deviceName.trim() !== '') {
    return res.json({
      processId: processId,
      isActive: true,
      hasGuess: false,
      message: 'Device already identified'
    });
  }
  
  try {
    // Try to match against existing patterns, excluding any rejected ones
    const rejectedPatterns = Array.isArray(process.rejectedPatterns) ? process.rejectedPatterns : [];
    const matches = patternAnalyzer.findAllMatchingPatterns(process, chargingPatterns, rejectedPatterns);
    
    if (matches.length > 0) {
      const bestMatch = matches[0];
      res.json({
        processId: processId,
        isActive: true,
        hasGuess: true,
        guessedDevice: bestMatch.pattern.deviceName,
        patternId: bestMatch.pattern.id,
        confidence: bestMatch.similarity,
        message: 'Educated guess based on power consumption profile'
      });
    } else {
      res.json({
        processId: processId,
        isActive: true,
        hasGuess: false,
        message: 'Not enough data or no matching pattern found'
      });
    }
  } catch (error) {
    console.error(`Error finding pattern match for process ${processId}:`, error);
    res.status(500).json({
      error: 'Failed to generate educated guess',
      processId: processId,
      isActive: true,
      hasGuess: false
    });
  }
});

// Reject a pattern guess and get the next best match
app.post('/api/processes/:id/reject-guess', (req, res) => {
  const processId = parseInt(req.params.id);
  const { rejectedPatternId } = req.body;
  
  // Validate that the ID is a valid positive integer
  if (isNaN(processId) || processId <= 0 || !Number.isInteger(processId)) {
    return res.status(400).json({ error: 'Invalid process ID' });
  }
  
  const process = chargingProcesses.find(p => p.id === processId);
  
  if (!process) {
    return res.status(404).json({ error: 'Process not found' });
  }
  
  // Only allow rejecting guesses for active (incomplete) processes
  if (process.endTime) {
    return res.json({
      processId: processId,
      isActive: false,
      hasGuess: false,
      message: 'Process is completed, cannot reject guess'
    });
  }
  
  try {
    // Initialize rejectedPatterns array if it doesn't exist
    if (!process.rejectedPatterns) {
      process.rejectedPatterns = [];
    }
    
    // Add the rejected pattern ID to the list if provided and not already there
    if (rejectedPatternId && !process.rejectedPatterns.includes(rejectedPatternId)) {
      process.rejectedPatterns.push(rejectedPatternId);
      console.log(`Rejected pattern ${rejectedPatternId} for process ${processId}`);
    }
    
    // Save the updated process
    storage.saveProcesses(chargingProcesses);
    
    // Find all matching patterns (including ALL matches, not excluding rejected ones initially)
    const allMatches = patternAnalyzer.findAllMatchingPatterns(process, chargingPatterns, []);
    
    if (allMatches.length === 0) {
      return res.json({
        processId: processId,
        isActive: true,
        hasGuess: false,
        message: 'No matching patterns found'
      });
    }
    
    // Try to find a non-rejected pattern first
    const nonRejectedMatches = allMatches.filter(m => !process.rejectedPatterns.includes(m.pattern.id));
    
    let nextMatch;
    let cycled = false;
    
    if (nonRejectedMatches.length > 0) {
      // Use the best non-rejected match
      nextMatch = nonRejectedMatches[0];
    } else {
      // All patterns have been rejected, cycle back to the first one
      nextMatch = allMatches[0];
      cycled = true;
      // Clear rejected patterns since we're cycling through again
      process.rejectedPatterns = [];
      storage.saveProcesses(chargingProcesses);
      console.log(`All patterns rejected for process ${processId}, cycling back to first match`);
    }
    
    res.json({
      processId: processId,
      isActive: true,
      hasGuess: true,
      guessedDevice: nextMatch.pattern.deviceName,
      patternId: nextMatch.pattern.id,
      confidence: nextMatch.similarity,
      totalMatches: allMatches.length,
      cycled: cycled,
      message: cycled 
        ? `Cycled back to first option (${allMatches.length} total option${allMatches.length > 1 ? 's' : ''})`
        : `Next best match (${allMatches.length} total option${allMatches.length > 1 ? 's' : ''})`
    });
  } catch (error) {
    console.error(`Error rejecting pattern guess for process ${processId}:`, error);
    res.status(500).json({
      error: 'Failed to reject pattern guess',
      processId: processId,
      isActive: true,
      hasGuess: false
    });
  }
});

// Estimate completion time for an active process
// Returns estimated remaining time based on pattern matching
app.get('/api/processes/:id/estimate', (req, res) => {
  const processId = parseInt(req.params.id);
  
  // Validate that the ID is a valid positive integer
  if (isNaN(processId) || processId <= 0 || !Number.isInteger(processId)) {
    return res.status(400).json({ error: 'Invalid process ID' });
  }
  
  const process = chargingProcesses.find(p => p.id === processId);
  
  if (!process) {
    return res.status(404).json({ error: 'Process not found' });
  }
  
  // Only provide estimates for active (incomplete) processes
  if (process.endTime) {
    return res.json({
      processId: processId,
      isActive: false,
      hasEstimate: false,
      message: 'Process is completed, no estimate needed'
    });
  }
  
  try {
    const estimate = patternAnalyzer.estimateCompletionTime(process, chargingPatterns);
    
    if (estimate) {
      res.json({
        processId: processId,
        isActive: true,
        hasEstimate: true,
        ...estimate
      });
    } else {
      res.json({
        processId: processId,
        isActive: true,
        hasEstimate: false,
        message: 'Not enough data or no matching pattern found to estimate completion time'
      });
    }
  } catch (error) {
    console.error(`Error estimating completion time for process ${processId}:`, error);
    res.status(500).json({
      error: 'Failed to estimate completion time',
      processId: processId,
      isActive: true,
      hasEstimate: false
    });
  }
});

// Check if a charger's active process is in completion phase
app.get('/api/chargers/:chargerId/completion-status', (req, res) => {
  const { chargerId } = req.params;
  
  const chargerState = chargerStates[chargerId];
  
  if (!chargerState) {
    return res.status(404).json({ error: 'Charger not found' });
  }
  
  // If charger is not on or has no active process, it's not in completion phase
  if (!chargerState.isOn || chargerState.currentProcessId === null) {
    return res.json({
      chargerId: chargerId,
      isActive: false,
      isInCompletionPhase: false,
      message: 'No active charging process'
    });
  }
  
  const process = chargingProcesses.find(p => p.id === chargerState.currentProcessId);
  
  if (!process || process.endTime) {
    return res.json({
      chargerId: chargerId,
      isActive: false,
      isInCompletionPhase: false,
      message: 'Process not found or already completed'
    });
  }
  
  try {
    // Check if in completion phase (power below 5W threshold for 5 minutes)
    const isCompleting = patternAnalyzer.isInCompletionPhase(process);
    
    res.json({
      chargerId: chargerId,
      processId: process.id,
      isActive: true,
      isInCompletionPhase: isCompleting,
      message: isCompleting ? 'Charging is nearing completion' : 'Charging in progress'
    });
  } catch (error) {
    console.error(`Error checking completion status for charger ${chargerId}:`, error);
    res.status(500).json({
      error: 'Failed to check completion status',
      chargerId: chargerId,
      isActive: true,
      isInCompletionPhase: false
    });
  }
});

// Pattern Label Management Endpoints

// Update device label for a pattern
app.put('/api/patterns/:patternId/label', (req, res) => {
  const { patternId } = req.params;
  const { newLabel, shouldRenameAll } = req.body;
  
  if (!newLabel || typeof newLabel !== 'string' || newLabel.trim() === '') {
    return res.status(400).json({ error: 'Invalid label' });
  }
  
  const trimmedLabel = newLabel.trim();
  
  // Try to update the label
  const result = patternAnalyzer.updatePatternLabel(chargingPatterns, patternId, trimmedLabel);
  
  if (!result.success) {
    if (result.shouldMerge) {
      // Label exists, client needs to decide whether to merge
      return res.status(409).json({ 
        error: result.error, 
        shouldMerge: true,
        targetPatternId: result.targetPatternId 
      });
    }
    return res.status(404).json({ error: result.error });
  }
  
  // If shouldRenameAll is true, update all processes in the pattern to match the new label
  // This ensures that renaming a pattern also renames all its associated processes (CPIs)
  // Note: We don't check for result.oldLabel here because we want to update processes
  // even if the pattern previously had no deviceName (e.g., patterns created during analysis)
  if (shouldRenameAll) {
    const pattern = chargingPatterns.find(p => p.id === patternId);
    if (pattern && pattern.processIds) {
      // Create a Map for O(1) process lookup to avoid O(n*m) complexity
      const processMap = new Map(chargingProcesses.map(p => [p.id, p]));
      
      let updatedCount = 0;
      pattern.processIds.forEach(processId => {
        const process = processMap.get(processId);
        if (process) {
          // Update deviceName to reflect the charged device (e.g., "iPhone", "TonieBox")
          // Note: deviceName historically meant charger name (backward compatibility), 
          // but is now being repurposed to mean the device being charged
          process.deviceName = trimmedLabel;
          updatedCount++;
        }
      });
      
      if (updatedCount > 0) {
        // Only save if we actually updated some processes (avoids unnecessary I/O)
        storage.saveProcesses(chargingProcesses);
        // Sanitize label for safe logging (replace newlines and control characters)
        const sanitizedLabel = trimmedLabel.replace(/[\r\n\t]/g, ' ');
        console.log(`Updated deviceName for ${updatedCount} processes to "${sanitizedLabel}"`);
      }
    }
  }
  
  // Save updated patterns after process updates to maintain consistency
  patternAnalyzer.savePatterns(chargingPatterns);
  
  // Sanitize labels for safe logging (replace newlines and control characters)
  const sanitizedOldLabel = result.oldLabel ? result.oldLabel.replace(/[\r\n\t]/g, ' ') : 'undefined';
  const sanitizedNewLabel = trimmedLabel.replace(/[\r\n\t]/g, ' ');
  console.log(`Updated pattern ${patternId} label from "${sanitizedOldLabel}" to "${sanitizedNewLabel}"`);
  
  res.json({ 
    success: true, 
    message: 'Label updated successfully',
    oldLabel: result.oldLabel,
    newLabel: trimmedLabel,
    processesUpdated: shouldRenameAll
  });
});

// Merge two patterns
app.post('/api/patterns/merge', (req, res) => {
  const { sourcePatternId, targetPatternId } = req.body;
  
  if (!sourcePatternId || !targetPatternId) {
    return res.status(400).json({ error: 'Source and target pattern IDs required' });
  }
  
  if (sourcePatternId === targetPatternId) {
    return res.status(400).json({ error: 'Cannot merge a pattern with itself' });
  }
  
  const result = patternAnalyzer.mergePatterns(chargingPatterns, sourcePatternId, targetPatternId);
  
  if (!result.success) {
    return res.status(404).json({ error: result.error });
  }
  
  // Save updated patterns
  patternAnalyzer.savePatterns(chargingPatterns);
  
  // Update all processes from source pattern to use target pattern's device name
  const targetPattern = chargingPatterns.find(p => p.id === targetPatternId);
  if (targetPattern && targetPattern.processIds) {
    targetPattern.processIds.forEach(processId => {
      const process = chargingProcesses.find(p => p.id === processId);
      if (process) {
        // Update deviceName to reflect the charged device (e.g., "iPhone", "TonieBox")
        // Note: deviceName historically meant charger name (backward compatibility), 
        // but is now being repurposed to mean the device being charged
        process.deviceName = targetPattern.deviceName;
      }
    });
    storage.saveProcesses(chargingProcesses);
  }
  
  console.log(`Merged pattern ${sourcePatternId} into ${targetPatternId}`);
  
  res.json({
    success: true,
    message: 'Patterns merged successfully',
    mergedPattern: result.mergedPattern,
    removedPatternId: result.removedPatternId
  });
});

// Create a new pattern manually
app.post('/api/patterns', (req, res) => {
  const { deviceName, chargerId } = req.body;
  
  if (!deviceName || typeof deviceName !== 'string' || deviceName.trim() === '') {
    return res.status(400).json({ error: 'Device name is required' });
  }
  
  const trimmedDeviceName = deviceName.trim();
  
  // Check if a pattern with this name already exists
  const existingPattern = chargingPatterns.find(p => p.deviceName === trimmedDeviceName);
  if (existingPattern) {
    return res.status(409).json({ 
      error: 'A pattern with this device name already exists',
      existingPatternId: existingPattern.id
    });
  }
  
  // Generate unique pattern ID
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  const patternId = `pattern_${timestamp}_${random}`;
  
  // Create new pattern with minimal data (no processes yet)
  const newPattern = {
    id: patternId,
    deviceId: chargerId || null,
    chargerId: chargerId || null,
    chargerName: chargerId || 'Manual',
    deviceName: trimmedDeviceName,
    count: 0,
    processIds: [],
    averageProfile: null,
    statistics: null,
    firstSeen: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    manuallyCreated: true // Mark as manually created
  };
  
  chargingPatterns.push(newPattern);
  
  // Save patterns
  patternAnalyzer.savePatterns(chargingPatterns);
  
  console.log(`Created new pattern manually: ${patternId} with name "${trimmedDeviceName}"`);
  
  res.json({
    success: true,
    message: 'Pattern created successfully',
    pattern: newPattern
  });
});

// Delete a pattern
app.delete('/api/patterns/:patternId', (req, res) => {
  const { patternId } = req.params;
  
  const result = patternAnalyzer.deletePattern(chargingPatterns, patternId);
  
  if (!result.success) {
    return res.status(404).json({ error: result.error });
  }
  
  // Save updated patterns
  patternAnalyzer.savePatterns(chargingPatterns);
  
  // Note: We don't delete the processes, we just remove their pattern association
  // The processes still exist with their original deviceName
  
  console.log(`Deleted pattern ${patternId}`);
  
  res.json({
    success: true,
    message: 'Pattern deleted successfully',
    deletedPattern: result.deletedPattern
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  
  // Note: Pattern analysis is NOT run automatically
  // Patterns are loaded from disk and used as-is
  // Pattern analysis only runs when explicitly triggered via API endpoints:
  // - POST /api/patterns/analyze - Manually trigger pattern analysis
  // - POST /api/patterns/rerun - Clear all patterns and reanalyze from scratch
});

// Graceful shutdown handler to save data before exit
function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal}, saving data and shutting down gracefully...`);
  
  // Clear any pending save timer and save immediately
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  storage.saveProcesses(chargingProcesses);
  storage.saveProcessCounter(processIdCounter);
  patternAnalyzer.savePatterns(chargingPatterns);
  storage.saveAutoOffState(autoOffState);

  // Clear all appliance cycle-end timers
  Object.keys(applianceStates).forEach(applianceId => {
    const appliance = applianceStates[applianceId];
    if (appliance && appliance.cycleEndTimer) {
      clearTimeout(appliance.cycleEndTimer);
      appliance.cycleEndTimer = null;
    }
  });
  
  // Close MQTT connection with timeout
  if (mqttClient && mqttClient.connected) {
    const shutdownTimeout = setTimeout(() => {
      console.log('MQTT disconnect timeout, forcing exit');
      process.exit(0);
    }, 5000);
    
    mqttClient.end(false, (err) => {
      clearTimeout(shutdownTimeout);
      if (err) {
        console.error('Error disconnecting MQTT client:', err);
      } else {
        console.log('MQTT client disconnected');
      }
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
