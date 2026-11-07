'use strict';

/**
 * Restore the newest open session for each configured charger. Do not infer
 * physical relay state from persisted history: await a fresh relay message.
 */
function recoverChargerStates(configs, processes, previous = {}) {
  const result = {};
  for (const charger of configs) {
    const open = processes
      .filter(p => !p.endTime && (p.chargerId ?? p.deviceId) === charger.id)
      .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime))[0];
    const old = previous[charger.id];
    result[charger.id] = {
      name: charger.name, topic: charger.topic,
      isOn: Boolean(old?.isOn),
      power: old?.power ?? 0,
      currentProcessId: open?.id ?? null,
      relayConfirmed: false
    };
  }
  return result;
}

function relayAction(state, isOn) {
  if (!state.relayConfirmed) {
    // A fresh ON confirms the recovered process; a fresh OFF closes it.
    if (isOn) return state.currentProcessId == null ? 'start' : 'resume';
    return state.currentProcessId == null ? 'idle' : 'end';
  }
  if (isOn) return state.isOn ? 'noop' : 'start';
  return state.currentProcessId == null ? 'idle' : 'end';
}

function recoverApplianceStates(configs, processes, previous = {}) {
  const result = {};
  for (const appliance of configs) {
    const open = processes
      .filter(p => p.processType === 'appliance' && p.applianceId === appliance.id && !p.endTime)
      .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime))[0];
    const old = previous[appliance.id];
    if (old?.cycleEndTimer) clearTimeout(old.cycleEndTimer);
    result[appliance.id] = {
      name: appliance.name, topic: appliance.topic, notifyTopic: appliance.notifyTopic,
      power: 0, isRunning: Boolean(open), currentProcessId: open?.id ?? null,
      cycleEndDetectedAt: null, cycleEndTimer: null, telemetryConfirmed: false
    };
  }
  return result;
}

function parseRelayState(payload) {
  const normalized = String(payload).trim().toLowerCase();
  if (normalized === 'on' || normalized === '1' || normalized === 'true') return true;
  if (normalized === 'off' || normalized === '0' || normalized === 'false') return false;
  return null;
}

module.exports = { recoverChargerStates, recoverApplianceStates, relayAction, parseRelayState };
