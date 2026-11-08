'use strict';

const DEFAULT_LIMIT = 200;
function createEventJournal({ limit = DEFAULT_LIMIT, now = () => new Date().toISOString() } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) {
    throw new Error('Journal limit must be between 1 and 10000');
  }
  let nextId = 1;
  const events = [];
  return {
    record(type, details = {}) {
      if (typeof type !== 'string' || !type.trim()) throw new Error('Event type required');
      const event = { id: nextId++, timestamp: now(), type, details: { ...details } };
      events.push(event);
      if (events.length > limit) events.splice(0, events.length - limit);
      return event;
    },
    list({ type, sinceId, limit: count = 50 } = {}) {
      const safeCount = Number.isSafeInteger(count) ? Math.max(1, Math.min(count, limit)) : 50;
      return events.filter(event => (!type || event.type === type) &&
        (!sinceId || event.id > sinceId)).slice(-safeCount);
    },
    stats() { return { count: events.length, capacity: limit, latestId: nextId - 1 }; }
  };
}

function autoOffDiagnosis({ mqttConnected, charger, autoOff, process, lastPowerTimestamp, now = Date.now() }) {
  if (!autoOff?.enabled) return { eligible: false, reason: 'disabled' };
  if (!mqttConnected) return { eligible: false, reason: 'mqtt_disconnected' };
  if (!charger) return { eligible: false, reason: 'charger_unknown' };
  if (!charger.isOn) return { eligible: false, reason: 'relay_off' };
  if (!charger.relayConfirmed) return { eligible: false, reason: 'relay_unconfirmed' };
  if (!process || process.endTime) return { eligible: false, reason: 'no_active_process' };
  const age = lastPowerTimestamp ? now - Date.parse(lastPowerTimestamp) : NaN;
  if (!Number.isFinite(age) || age < 0 || age > 120000) {
    return { eligible: false, reason: 'telemetry_stale', sampleAgeMs: Number.isFinite(age) ? age : null };
  }
  return { eligible: true, reason: autoOff.completionDetectedAt ? 'completion_timer_active' : 'monitoring', sampleAgeMs: age };
}

module.exports = { createEventJournal, autoOffDiagnosis };
