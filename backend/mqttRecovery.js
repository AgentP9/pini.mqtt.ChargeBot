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
      currentProcessId: old?.currentProcessId ?? open?.id ?? null,
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

module.exports = { recoverChargerStates, relayAction };
