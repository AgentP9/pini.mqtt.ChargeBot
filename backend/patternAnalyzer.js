const fs = require('fs');
const path = require('path');

// Friendly names for pattern-identified devices being charged
// These represent actual devices like iPhones, TonieBoxes, etc.
// IMPORTANT: This array must be kept in sync with frontend/src/constants/deviceNames.js
const FRIENDLY_DEVICE_NAMES = [
  'Hugo', 'Egon', 'Tom', 'Jerry', 'Alice', 
  'Bob', 'Charlie', 'Diana', 'Emma', 'Frank'
];

// Similarity threshold for pattern matching
// Processes with similarity > this threshold are considered the same device
const SIMILARITY_THRESHOLD = 0.65;

// High confidence threshold for auto-assigning device names
// When a charging process completes with a pattern match above this threshold,
// automatically assign the device name
const HIGH_CONFIDENCE_THRESHOLD = 0.85;

// Pre-compiled regex patterns for checking numbered variants
// This improves performance when isManuallyCustomized is called frequently
const NUMBERED_VARIANT_PATTERNS = FRIENDLY_DEVICE_NAMES.map(
  baseName => new RegExp(`^${baseName}\\s+\\d+$`)
);

// Data directory for persistent storage
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PATTERNS_FILE = path.join(DATA_DIR, 'charging-patterns.json');

/**
 * Ensure the data directory exists
 */
function ensureDataDirectory() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Calculate power consumption profile characteristics for a charging process
 * This creates a "fingerprint" of how power is consumed over time
 * @param {Object} process - A charging process with events
 * @returns {Object} Power profile characteristics
 */
function calculatePowerProfile(process) {
  const powerEvents = process.events.filter(e => e.type === 'power_consumption' && e.value > 0);
  
  // Require at least 3 power consumption events for reliable pattern analysis
  if (powerEvents.length < 3) {
    console.log(`Process ${process.id}: Insufficient power data (${powerEvents.length} events, need 3+)`);
    return null;
  }
  
  const powerValues = powerEvents.map(e => e.value);
  const sum = powerValues.reduce((a, b) => a + b, 0);
  const mean = sum / powerValues.length;
  
  // Calculate standard deviation
  const variance = powerValues.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / powerValues.length;
  const stdDev = Math.sqrt(variance);
  
  // Calculate min, max
  const min = Math.min(...powerValues);
  const max = Math.max(...powerValues);
  
  // Calculate percentiles
  const sorted = [...powerValues].sort((a, b) => a - b);
  const p25 = sorted[Math.floor(sorted.length * 0.25)];
  const p50 = sorted[Math.floor(sorted.length * 0.5)]; // median
  const p75 = sorted[Math.floor(sorted.length * 0.75)];
  
  // Calculate peak power period (sustained high power)
  const highPowerThreshold = mean + stdDev;
  const highPowerEvents = powerEvents.filter(e => e.value >= highPowerThreshold);
  const peakPowerRatio = highPowerEvents.length / powerEvents.length;
  
  // Calculate power consumption curve shape
  // Divide into early, middle, late phases
  const third = Math.max(1, Math.floor(powerEvents.length / 3));
  const earlyEvents = powerEvents.slice(0, third);
  const middleEvents = powerEvents.slice(third, third * 2);
  const lateEvents = powerEvents.slice(third * 2);
  
  const earlyMean = earlyEvents.length > 0 ? earlyEvents.reduce((sum, e) => sum + e.value, 0) / earlyEvents.length : mean;
  const middleMean = middleEvents.length > 0 ? middleEvents.reduce((sum, e) => sum + e.value, 0) / middleEvents.length : mean;
  const lateMean = lateEvents.length > 0 ? lateEvents.reduce((sum, e) => sum + e.value, 0) / lateEvents.length : mean;
  
  return {
    mean: parseFloat(mean.toFixed(2)),
    stdDev: parseFloat(stdDev.toFixed(2)),
    min: parseFloat(min.toFixed(2)),
    max: parseFloat(max.toFixed(2)),
    median: parseFloat(p50.toFixed(2)),
    p25: parseFloat(p25.toFixed(2)),
    p75: parseFloat(p75.toFixed(2)),
    peakPowerRatio: parseFloat(peakPowerRatio.toFixed(3)),
    curveShape: {
      early: parseFloat(earlyMean.toFixed(2)),
      middle: parseFloat(middleMean.toFixed(2)),
      late: parseFloat(lateMean.toFixed(2))
    }
  };
}

/**
 * Check if a device name appears to be manually customized (not a default friendly name)
 * @param {string} deviceName - The device name to check
 * @returns {boolean} True if the name appears to be manually customized
 */
function isManuallyCustomized(deviceName) {
  if (!deviceName) {
    return false;
  }
  
  // Check if it's one of the default friendly names
  if (FRIENDLY_DEVICE_NAMES.includes(deviceName)) {
    return false;
  }
  
  // Check if it's a numbered variant like "Hugo 2", "Egon 3", etc.
  // Use pre-compiled patterns for better performance
  for (const pattern of NUMBERED_VARIANT_PATTERNS) {
    if (pattern.test(deviceName)) {
      return false; // It's an auto-generated numbered variant
    }
  }
  
  // If it doesn't match any default pattern, it's manually customized
  return true;
}

/**
 * Calculate duration of a charging process in minutes
 * @param {Object} process - A charging process
 * @returns {number|null} Duration in minutes, or null if not completed
 */
function calculateDuration(process) {
  if (!process.endTime) {
    return null;
  }
  
  const start = new Date(process.startTime);
  const end = new Date(process.endTime);
  return (end - start) / 1000 / 60; // Convert to minutes
}

/**
 * Calculate similarity score between two power profiles
 * @param {Object} profile1 - First power profile
 * @param {Object} profile2 - Second power profile
 * @returns {number} Similarity score (0-1, where 1 is identical)
 */
function calculateProfileSimilarity(profile1, profile2) {
  if (!profile1 || !profile2) {
    return 0;
  }
  
  // Weight different characteristics
  const weights = {
    mean: 0.20,
    median: 0.15,
    stdDev: 0.10,
    peakPowerRatio: 0.15,
    curveShape: 0.40
  };
  
  let totalSimilarity = 0;
  
  // Compare mean power
  const meanDiff = Math.abs(profile1.mean - profile2.mean);
  const meanSimilarity = Math.max(0, 1 - meanDiff / Math.max(profile1.mean, profile2.mean));
  totalSimilarity += meanSimilarity * weights.mean;
  
  // Compare median
  const medianDiff = Math.abs(profile1.median - profile2.median);
  const medianSimilarity = Math.max(0, 1 - medianDiff / Math.max(profile1.median, profile2.median));
  totalSimilarity += medianSimilarity * weights.median;
  
  // Compare standard deviation
  const stdDevDiff = Math.abs(profile1.stdDev - profile2.stdDev);
  // Handle zero standard deviation case explicitly - if both are zero, they're similar
  let stdDevSimilarity;
  if (profile1.stdDev === 0 && profile2.stdDev === 0) {
    stdDevSimilarity = 1.0; // Both have no variance - perfectly similar
  } else if (profile1.stdDev === 0 || profile2.stdDev === 0) {
    stdDevSimilarity = 0; // One has variance, the other doesn't - not similar
  } else {
    stdDevSimilarity = Math.max(0, 1 - stdDevDiff / Math.max(profile1.stdDev, profile2.stdDev));
  }
  totalSimilarity += stdDevSimilarity * weights.stdDev;
  
  // Compare peak power ratio
  const peakDiff = Math.abs(profile1.peakPowerRatio - profile2.peakPowerRatio);
  const peakSimilarity = Math.max(0, 1 - peakDiff);
  totalSimilarity += peakSimilarity * weights.peakPowerRatio;
  
  // Compare curve shape (most important for device identification)
  const earlyDiff = Math.abs(profile1.curveShape.early - profile2.curveShape.early);
  const middleDiff = Math.abs(profile1.curveShape.middle - profile2.curveShape.middle);
  const lateDiff = Math.abs(profile1.curveShape.late - profile2.curveShape.late);
  const maxCurveValue = Math.max(
    profile1.curveShape.early, profile1.curveShape.middle, profile1.curveShape.late,
    profile2.curveShape.early, profile2.curveShape.middle, profile2.curveShape.late,
    1
  );
  const curveSimilarity = Math.max(0, 1 - (earlyDiff + middleDiff + lateDiff) / (3 * maxCurveValue));
  totalSimilarity += curveSimilarity * weights.curveShape;
  
  return parseFloat(totalSimilarity.toFixed(3));
}

/**
 * Analyze charging processes and identify patterns
 * Groups similar charging sessions together to identify the same devices
 * @param {Array} processes - Array of all charging processes
 * @param {Array} existingPatterns - Optional array of existing patterns to preserve user customizations
 * @returns {Array} Array of identified patterns with grouped processes
 */
function analyzePatterns(processes, existingPatterns = []) {
  console.log(`Pattern analysis: Starting with ${processes.length} total processes`);
  
  // Only analyze completed charger processes with power data
  // (appliance processes use processType: 'appliance' and are excluded)
  const completedProcesses = processes.filter(p => 
    p.endTime && 
    p.processType !== 'appliance' &&
    p.events.some(e => e.type === 'power_consumption')
  );
  
  console.log(`Pattern analysis: ${completedProcesses.length} completed processes with power data`);
  
  if (completedProcesses.length === 0) {
    console.log('Pattern analysis: No completed processes to analyze');
    return [];
  }
  
  // Calculate profiles for all processes
  const processesWithProfiles = completedProcesses.map(process => ({
    process,
    profile: calculatePowerProfile(process),
    duration: calculateDuration(process)
  })).filter(p => p.profile !== null);
  
  console.log(`Pattern analysis: ${processesWithProfiles.length} processes with valid profiles`);
  
  if (processesWithProfiles.length === 0) {
    console.log('Pattern analysis: No processes with valid power profiles');
    return [];
  }
  
  // Create a map of processId -> existing pattern for quick lookup
  const processToExistingPattern = new Map();
  existingPatterns.forEach(pattern => {
    if (pattern.processIds) {
      pattern.processIds.forEach(processId => {
        processToExistingPattern.set(processId, pattern);
      });
    }
  });
  
  // Group similar processes into patterns
  const patterns = [];
  // Track which existing pattern IDs have been restored to avoid duplicates
  const restoredPatternIds = new Set();
  
  processesWithProfiles.forEach(({ process, profile, duration }) => {
    // First, check if this process was in an existing pattern (to preserve user customizations)
    const existingPatternForProcess = processToExistingPattern.get(process.id);
    
    // Check if this process has a manually customized device name
    const processDeviceName = process.deviceName;
    const processChargerName = process.chargerName || process.deviceName || process.chargerId || process.deviceId;
    const processHasManualName = processDeviceName && 
                                  processDeviceName !== processChargerName && 
                                  isManuallyCustomized(processDeviceName);
    
    // Find existing pattern that matches in the new patterns array
    let matchedPattern = null;
    let maxSimilarity = 0;
    
    for (const pattern of patterns) {
      // If process has a manual name, only match patterns with the same device name
      // This ensures processes with different manual names are kept in separate patterns
      if (processHasManualName && pattern.deviceName !== processDeviceName) {
        continue; // Skip patterns with different device names
      }
      
      const similarity = calculateProfileSimilarity(profile, pattern.averageProfile);
      if (similarity > maxSimilarity && similarity >= SIMILARITY_THRESHOLD) {
        maxSimilarity = similarity;
        matchedPattern = pattern;
      }
    }
    
    if (matchedPattern) {
      // Add to existing pattern
      matchedPattern.processIds.push(process.id);
      matchedPattern.count++;
      matchedPattern.durations.push(duration);
      matchedPattern.lastSeen = process.endTime;
      
      // Check if we should preserve a manually customized name over an auto-generated one
      // This handles cases where a pattern with an auto-generated name (e.g., "Hugo") 
      // matches a process with a manually assigned name (e.g., "My Device")
      if (processHasManualName && !isManuallyCustomized(matchedPattern.deviceName)) {
        console.log(`Pattern analysis: Using manually assigned device name "${processDeviceName}" from process ${process.id} over auto-generated "${matchedPattern.deviceName}"`);
        matchedPattern.deviceName = processDeviceName;
      } else if (existingPatternForProcess && 
                 isManuallyCustomized(existingPatternForProcess.deviceName) &&
                 !isManuallyCustomized(matchedPattern.deviceName)) {
        console.log(`Pattern analysis: Preserving manual device name "${existingPatternForProcess.deviceName}" over auto-generated "${matchedPattern.deviceName}"`);
        matchedPattern.deviceName = existingPatternForProcess.deviceName;
      }
      
      // Update average profile (simple running average)
      const oldWeight = matchedPattern.count - 1;
      const newWeight = 1;
      const totalWeight = matchedPattern.count;
      
      for (const key of ['mean', 'stdDev', 'min', 'max', 'median', 'p25', 'p75', 'peakPowerRatio']) {
        matchedPattern.averageProfile[key] = parseFloat(
          ((matchedPattern.averageProfile[key] * oldWeight + profile[key] * newWeight) / totalWeight).toFixed(2)
        );
      }
      
      for (const phase of ['early', 'middle', 'late']) {
        matchedPattern.averageProfile.curveShape[phase] = parseFloat(
          ((matchedPattern.averageProfile.curveShape[phase] * oldWeight + profile.curveShape[phase] * newWeight) / totalWeight).toFixed(2)
        );
      }
    } else {
      // Create new pattern
      // Check if we should restore from existing pattern to preserve user customizations
      let patternId, deviceName;
      
      if (existingPatternForProcess && 
          !restoredPatternIds.has(existingPatternForProcess.id) &&
          existingPatternForProcess.deviceName === processDeviceName) {
        // Reuse the existing pattern's ID and deviceName to preserve user customizations
        // Only do this if:
        // 1. We haven't already restored this pattern ID
        // 2. The device name matches (process hasn't been renamed to a different device)
        patternId = existingPatternForProcess.id;
        deviceName = existingPatternForProcess.deviceName;
        restoredPatternIds.add(patternId);
        console.log(`Pattern analysis: Restoring pattern ${patternId} with device name "${deviceName}"`);
      } else {
        // Generate unique pattern ID with high-resolution timestamp and random string
        // The combination of timestamp (millisecond precision) and random string
        // provides sufficient uniqueness for pattern IDs in normal usage
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 11);
        patternId = `pattern_${timestamp}_${random}`;
        const patternIndex = patterns.length;
        
        // Use manually assigned device name if available
        if (processHasManualName) {
          // Use the manually assigned device name from the process
          deviceName = processDeviceName;
          console.log(`Pattern analysis: Using manually assigned device name "${deviceName}" from process ${process.id}`);
        } else {
          // Generate unique friendly name - append number if we've exhausted the base names
          if (patternIndex < FRIENDLY_DEVICE_NAMES.length) {
            deviceName = FRIENDLY_DEVICE_NAMES[patternIndex];
          } else {
            const baseNameIndex = patternIndex % FRIENDLY_DEVICE_NAMES.length;
            const suffix = Math.floor(patternIndex / FRIENDLY_DEVICE_NAMES.length) + 1;
            deviceName = `${FRIENDLY_DEVICE_NAMES[baseNameIndex]} ${suffix}`;
          }
        }
      }
      
      patterns.push({
        id: patternId,
        deviceId: process.chargerId || process.deviceId, // Backward compatibility
        chargerId: process.chargerId || process.deviceId,
        chargerName: process.chargerName || process.deviceName || process.chargerId || process.deviceId,
        deviceName: deviceName, // Use preserved name or friendly name as default for charged device
        count: 1,
        processIds: [process.id],
        averageProfile: { ...profile },
        durations: [duration],
        firstSeen: process.startTime,
        lastSeen: process.endTime
      });
    }
  });
  
  // Calculate statistics for each pattern
  patterns.forEach(pattern => {
    const durations = pattern.durations;
    durations.sort((a, b) => a - b);
    
    pattern.statistics = {
      averageDuration: parseFloat((durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(2)),
      minDuration: parseFloat(Math.min(...durations).toFixed(2)),
      maxDuration: parseFloat(Math.max(...durations).toFixed(2)),
      medianDuration: parseFloat(durations[Math.floor(durations.length / 2)].toFixed(2)),
      totalSessions: pattern.count
    };
    
    // Remove raw durations array to save space
    delete pattern.durations;
    
    console.log(`Pattern ${pattern.id}: ${pattern.count} sessions, processes: [${pattern.processIds.join(', ')}]`);
  });
  
  // Sort patterns by frequency (most common first)
  patterns.sort((a, b) => b.count - a.count);
  
  console.log(`Pattern analysis complete: Found ${patterns.length} patterns`);
  
  return patterns;
}

/**
 * Load patterns from file
 * @returns {Array} Array of patterns
 */
function loadPatterns() {
  ensureDataDirectory();
  
  try {
    if (fs.existsSync(PATTERNS_FILE)) {
      const data = fs.readFileSync(PATTERNS_FILE, 'utf8');
      const patterns = JSON.parse(data);
      console.log(`Loaded ${patterns.length} charging patterns from storage`);
      return patterns;
    }
  } catch (error) {
    console.error('Error loading patterns from file:', error);
  }
  
  return [];
}

/**
 * Save patterns to file
 * @param {Array} patterns - Array of patterns to save
 */
function savePatterns(patterns) {
  ensureDataDirectory();
  
  const tempFile = `${PATTERNS_FILE}.tmp`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(patterns, null, 2), 'utf8');
    fs.renameSync(tempFile, PATTERNS_FILE);
    console.log(`Saved ${patterns.length} charging patterns to storage`);
  } catch (error) {
    console.error('Error saving patterns to file:', error);
    // Best-effort cleanup of temporary file if rename or write failed
    try {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    } catch (cleanupError) {
      console.warn('Failed to clean up temporary patterns file:', cleanupError);
    }
  }
}

/**
 * Find all matching patterns for a process, sorted by similarity
 * @param {Object} process - The charging process to match
 * @param {Array} patterns - Array of all patterns
 * @param {Array} excludePatternIds - Optional array of pattern IDs to exclude
 * @returns {Array} Array of matches sorted by similarity (highest first)
 */
function findAllMatchingPatterns(process, patterns, excludePatternIds = []) {
  const profile = calculatePowerProfile(process);
  if (!profile) {
    return [];
  }
  
  const matches = [];
  
  for (const pattern of patterns) {
    // Skip excluded patterns
    if (excludePatternIds.includes(pattern.id)) {
      continue;
    }
    
    const similarity = calculateProfileSimilarity(profile, pattern.averageProfile);
    if (similarity >= SIMILARITY_THRESHOLD) {
      matches.push({
        pattern,
        similarity: parseFloat(similarity.toFixed(3))
      });
    }
  }
  
  // Sort by similarity (highest first)
  matches.sort((a, b) => b.similarity - a.similarity);
  
  return matches;
}

/**
 * Find the pattern that best matches a given process
 * @param {Object} process - A charging process
 * @param {Array} patterns - Array of existing patterns
 * @returns {Object|null} Matching pattern or null if no match found
 */
function findMatchingPattern(process, patterns) {
  const profile = calculatePowerProfile(process);
  if (!profile) {
    return null;
  }
  
  let bestMatch = null;
  let bestSimilarity = 0;
  
  for (const pattern of patterns) {
    const similarity = calculateProfileSimilarity(profile, pattern.averageProfile);
    if (similarity > bestSimilarity && similarity >= SIMILARITY_THRESHOLD) {
      bestSimilarity = similarity;
      bestMatch = {
        pattern,
        similarity: parseFloat(similarity.toFixed(3))
      };
    }
  }
  
  return bestMatch;
}

// Constants for profile merging
const PROFILE_KEYS = ['mean', 'stdDev', 'min', 'max', 'median', 'p25', 'p75', 'peakPowerRatio'];
const CURVE_PHASES = ['early', 'middle', 'late'];

// Constants for completion time estimation
const CONFIDENCE_MULTIPLIER_PAST_AVERAGE = 0.7; // Lower confidence when past average duration
const CONFIDENCE_MULTIPLIER_EARLY_PHASE = 0.9;  // High confidence when still in early phase

/**
 * Update the device label for a pattern
 * Ensures label uniqueness by checking against other patterns
 * @param {Array} patterns - Array of all patterns
 * @param {string} patternId - ID of the pattern to update
 * @param {string} newLabel - New device label
 * @returns {Object} Result with success status and message
 */
function updatePatternLabel(patterns, patternId, newLabel) {
  const pattern = patterns.find(p => p.id === patternId);
  
  if (!pattern) {
    return { success: false, error: 'Pattern not found' };
  }
  
  // Check if label already exists in another pattern
  const existingPattern = patterns.find(p => p.id !== patternId && p.deviceName === newLabel);
  
  if (existingPattern) {
    return { success: false, error: 'Label already exists', shouldMerge: true, targetPatternId: existingPattern.id };
  }
  
  const oldLabel = pattern.deviceName;
  pattern.deviceName = newLabel;
  
  return { success: true, oldLabel, newLabel, patternId };
}

/**
 * Merge two patterns into one
 * Combines process IDs and recalculates statistics
 * @param {Array} patterns - Array of all patterns
 * @param {string} sourcePatternId - ID of pattern to merge from (will be removed)
 * @param {string} targetPatternId - ID of pattern to merge into (will be kept)
 * @returns {Object} Result with success status and updated patterns
 */
function mergePatterns(patterns, sourcePatternId, targetPatternId) {
  const sourceIndex = patterns.findIndex(p => p.id === sourcePatternId);
  const targetPattern = patterns.find(p => p.id === targetPatternId);
  
  if (sourceIndex === -1 || !targetPattern) {
    return { success: false, error: 'Pattern(s) not found' };
  }
  
  const sourcePattern = patterns[sourceIndex];
  
  // Merge process IDs
  targetPattern.processIds = [...targetPattern.processIds, ...sourcePattern.processIds];
  
  // Update count
  const oldTargetCount = targetPattern.count;
  targetPattern.count = targetPattern.processIds.length;
  
  // Merge average profile (weighted average based on counts)
  const sourceWeight = sourcePattern.count;
  const targetWeight = oldTargetCount;
  const totalWeight = sourceWeight + targetWeight;
  
  for (const key of PROFILE_KEYS) {
    if (key === 'min') {
      targetPattern.averageProfile[key] = Math.min(targetPattern.averageProfile[key], sourcePattern.averageProfile[key]);
    } else if (key === 'max') {
      targetPattern.averageProfile[key] = Math.max(targetPattern.averageProfile[key], sourcePattern.averageProfile[key]);
    } else {
      targetPattern.averageProfile[key] = parseFloat(
        ((targetPattern.averageProfile[key] * targetWeight + sourcePattern.averageProfile[key] * sourceWeight) / totalWeight).toFixed(2)
      );
    }
  }
  
  for (const phase of CURVE_PHASES) {
    targetPattern.averageProfile.curveShape[phase] = parseFloat(
      ((targetPattern.averageProfile.curveShape[phase] * targetWeight + sourcePattern.averageProfile.curveShape[phase] * sourceWeight) / totalWeight).toFixed(2)
    );
  }
  
  // Update timestamps
  if (new Date(sourcePattern.firstSeen) < new Date(targetPattern.firstSeen)) {
    targetPattern.firstSeen = sourcePattern.firstSeen;
  }
  if (new Date(sourcePattern.lastSeen) > new Date(targetPattern.lastSeen)) {
    targetPattern.lastSeen = sourcePattern.lastSeen;
  }
  
  // Merge statistics by recalculating from combined data
  if (sourcePattern.statistics && targetPattern.statistics) {
    // We don't have the raw durations, so we'll approximate
    const sourceTotalDuration = sourcePattern.statistics.averageDuration * sourcePattern.count;
    const targetTotalDuration = targetPattern.statistics.averageDuration * oldTargetCount;
    targetPattern.statistics.averageDuration = parseFloat(
      ((sourceTotalDuration + targetTotalDuration) / totalWeight).toFixed(2)
    );
    targetPattern.statistics.minDuration = Math.min(
      targetPattern.statistics.minDuration, 
      sourcePattern.statistics.minDuration
    );
    targetPattern.statistics.maxDuration = Math.max(
      targetPattern.statistics.maxDuration, 
      sourcePattern.statistics.maxDuration
    );
    targetPattern.statistics.totalSessions = totalWeight;
    // We cannot reliably compute a merged median without raw durations,
    // so set medianDuration to null to indicate it's unavailable after merging.
    targetPattern.statistics.medianDuration = null;
  }
  
  // Remove source pattern
  patterns.splice(sourceIndex, 1);
  
  return { success: true, mergedPattern: targetPattern, removedPatternId: sourcePatternId };
}

/**
 * Delete a pattern
 * @param {Array} patterns - Array of all patterns
 * @param {string} patternId - ID of pattern to delete
 * @returns {Object} Result with success status
 */
function deletePattern(patterns, patternId) {
  const index = patterns.findIndex(p => p.id === patternId);
  
  if (index === -1) {
    return { success: false, error: 'Pattern not found' };
  }
  
  const pattern = patterns[index];
  patterns.splice(index, 1);
  
  return { success: true, deletedPattern: pattern };
}

/**
 * Detect if a charging process is in its completion phase
 * This detects when power consumption drops below a threshold and stabilizes
 * with improved algorithm to prevent premature detection
 * @param {Object} process - Active charging process
 * @param {number} thresholdWatts - Power threshold below which we consider charging near complete (default 5W)
 * @param {number} stableMinutes - Number of minutes power must stay below threshold (default 10 minutes)
 * @returns {boolean} True if process appears to be in completion phase
 */
function isInCompletionPhase(process, thresholdWatts = 5, stableMinutes = 10) {
  if (!process || !process.events || process.endTime) {
    return false;
  }
  
  const powerEvents = process.events.filter(e => e.type === 'power_consumption');
  
  // Require more data points for reliable detection (increased from 10 to 20)
  if (powerEvents.length < 20) {
    return false; // Need more data
  }
  
  // Check recent events (last stableMinutes worth)
  const now = Date.now();
  const stableThresholdMs = stableMinutes * 60 * 1000;
  const recentEvents = powerEvents.filter(e => 
    now - new Date(e.timestamp).getTime() < stableThresholdMs
  );
  
  // Require more recent data points for better confidence (increased from 3 to 5)
  if (recentEvents.length < 5) {
    return false; // Need more recent data
  }
  
  // Check if all recent events are below threshold
  const allBelowThreshold = recentEvents.every(e => e.value < thresholdWatts);
  
  if (!allBelowThreshold) {
    return false;
  }
  
  // Additional check: verify power is declining or stable (not increasing)
  // Compare older events vs recent events to ensure we're not in a temporary dip
  const bufferMinutes = 5; // Look back 5 minutes before the stable period
  const bufferThresholdMs = (stableMinutes + bufferMinutes) * 60 * 1000;
  const bufferEvents = powerEvents.filter(e => {
    const eventTime = new Date(e.timestamp).getTime();
    const timeDiff = now - eventTime;
    return timeDiff >= stableThresholdMs && timeDiff < bufferThresholdMs;
  });
  
  // If we have buffer events, check that power isn't increasing
  if (bufferEvents.length >= 3) {
    const bufferAvg = bufferEvents.reduce((sum, e) => sum + e.value, 0) / bufferEvents.length;
    const recentAvg = recentEvents.reduce((sum, e) => sum + e.value, 0) / recentEvents.length;
    
    // If recent power is higher than buffer period, we might be charging again
    // Add a 20% tolerance to account for normal fluctuations
    if (recentAvg > bufferAvg * 1.2) {
      return false; // Power is increasing, not in completion phase
    }
  }
  
  return true;
}

/**
 * Estimate time until charging completion for an active process
 * Uses pattern matching to predict remaining time based on similar past charging sessions
 * @param {Object} process - Active charging process
 * @param {Array} patterns - Array of known charging patterns
 * @returns {Object|null} Estimation with remainingMinutes and confidence, or null if cannot estimate
 */
function estimateCompletionTime(process, patterns) {
  if (!process || process.endTime || !patterns || patterns.length === 0) {
    return null;
  }
  
  // Check if process is already in completion phase
  if (isInCompletionPhase(process)) {
    return {
      remainingMinutes: 0,
      confidence: 0.9,
      status: 'completing',
      message: 'Charging is complete or nearly complete'
    };
  }
  
  // Try to find matching pattern
  const match = findMatchingPattern(process, patterns);
  
  if (!match || !match.pattern.statistics || !match.pattern.statistics.averageDuration) {
    return null;
  }
  
  const pattern = match.pattern;
  const similarity = match.similarity;
  
  // Calculate elapsed time
  const startTime = new Date(process.startTime).getTime();
  const now = Date.now();
  const elapsedMinutes = (now - startTime) / 1000 / 60;
  
  // Use average duration from pattern
  const averageDuration = pattern.statistics.averageDuration;
  
  // Estimate remaining time
  let remainingMinutes = Math.max(0, averageDuration - elapsedMinutes);
  
  // Adjust confidence based on similarity and how much data we have
  let confidence = similarity;
  
  // If we have min/max duration, use that to refine the estimate
  if (pattern.statistics.minDuration && pattern.statistics.maxDuration) {
    const minDuration = pattern.statistics.minDuration;
    const maxDuration = pattern.statistics.maxDuration;
    
    // If elapsed time exceeds average, estimate based on max duration
    if (elapsedMinutes > averageDuration) {
      remainingMinutes = Math.max(0, maxDuration - elapsedMinutes);
      confidence *= CONFIDENCE_MULTIPLIER_PAST_AVERAGE; // Lower confidence since we're past average
    }
    
    // If elapsed time is less than min duration, we have high confidence
    if (elapsedMinutes < minDuration) {
      confidence *= CONFIDENCE_MULTIPLIER_EARLY_PHASE;
    }
  }
  
  // Round confidence to 2 decimal places
  confidence = parseFloat(confidence.toFixed(2));
  
  return {
    remainingMinutes: Math.round(remainingMinutes),
    confidence: Math.min(confidence, 0.95), // Cap at 0.95 since it's just an estimate
    estimatedTotalMinutes: Math.round(averageDuration),
    elapsedMinutes: Math.round(elapsedMinutes),
    patternDeviceName: pattern.deviceName,
    patternId: pattern.id,
    status: 'charging',
    message: `Estimated based on ${pattern.count} similar charging session${pattern.count > 1 ? 's' : ''}`
  };
}

module.exports = {
  analyzePatterns,
  loadPatterns,
  savePatterns,
  calculatePowerProfile,
  calculateDuration,
  calculateProfileSimilarity,
  findMatchingPattern,
  findAllMatchingPatterns,
  updatePatternLabel,
  mergePatterns,
  deletePattern,
  estimateCompletionTime,
  isInCompletionPhase,
  isManuallyCustomized,
  HIGH_CONFIDENCE_THRESHOLD
};
