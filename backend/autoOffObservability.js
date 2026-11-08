'use strict';

function createTransitionRecorder(journal) {
  const last = new Map();
  return {
    update(chargerId, reason, details = {}) {
      const previous = last.get(chargerId);
      if (previous === reason) return false;
      last.set(chargerId, reason);
      journal.record('auto_off_state_changed', { chargerId, reason, ...details });
      return true;
    },
    clear(chargerId) { last.delete(chargerId); },
    snapshot() { return Object.fromEntries(last); }
  };
}

/** Pure, deterministic safety decision for revalidation after the delay. */
function evaluateRevalidation({ mqttConnected, enabled, charger, process, expectedProcessId,
  completing, now = Date.now() }) {
  if (!mqttConnected) return { allowed: false, reason: 'mqtt_disconnected' };
  if (!enabled) return { allowed: false, reason: 'disabled' };
  if (!charger?.isOn || !charger.relayConfirmed) return { allowed: false, reason: 'relay_unconfirmed_or_off' };
  if (!process || process.endTime || charger.currentProcessId !== expectedProcessId || process.id !== expectedProcessId) {
    return { allowed: false, reason: 'session_changed' };
  }
  const fresh = (process.events || []).some(event => {
    if (event.type !== 'power_consumption') return false;
    const age = now - Date.parse(event.timestamp);
    return Number.isFinite(age) && age >= 0 && age < 120000;
  });
  if (!fresh) return { allowed: false, reason: 'telemetry_stale' };
  if (!completing) return { allowed: false, reason: 'charging_resumed' };
  return { allowed: true, reason: 'completion_confirmed' };
}

module.exports = { createTransitionRecorder, evaluateRevalidation };
