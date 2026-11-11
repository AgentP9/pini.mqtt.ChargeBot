import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import './DiagnosticsPage.css';

const API_URL = import.meta.env.VITE_API_URL || '/api';
const LABELS = {
  disabled: 'Auto-off disabled', mqtt_disconnected: 'MQTT disconnected',
  charger_unknown: 'Charger unknown', relay_off: 'Relay is off',
  relay_unconfirmed: 'Waiting for relay confirmation',
  no_active_process: 'No active charging session',
  telemetry_stale: 'Power telemetry missing or stale',
  completion_timer_active: 'Completion timer running',
  monitoring: 'Monitoring active session'
};
const formatTime = value => value ? new Date(value).toLocaleString() : '—';

export default function DiagnosticsPage() {
  const [status, setStatus] = useState(null);
  const [events, setEvents] = useState([]);
  const [completion, setCompletion] = useState({});
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState(null);
  const refresh = useCallback(async () => {
    try {
      const [statusResponse, eventResponse] = await Promise.all([
        axios.get(`${API_URL}/diagnostics/status`),
        axios.get(`${API_URL}/diagnostics/events`, { params: { limit: 100 } })
      ]);
      setStatus(statusResponse.data);
      setEvents(eventResponse.data.events || []);
      const chargers = statusResponse.data.chargers || [];
      const results = await Promise.allSettled(chargers.map(charger =>
        axios.get(`${API_URL}/chargers/${encodeURIComponent(charger.id)}/completion-assessment`)));
      setCompletion(Object.fromEntries(chargers.map((charger, index) =>
        [charger.id, results[index].status === 'fulfilled' ? results[index].value.data : null])));
      setUpdated(new Date());
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Diagnostics unavailable');
    }
  }, []);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const visibleEvents = filter ? events.filter(event => event.type === filter) : events;
  const types = [...new Set(events.map(event => event.type))].sort();

  return (
    <section className="diagnostics-page">
      <div className="diagnostics-heading">
        <div><h2>System diagnostics</h2><p>Live state and recent runtime events</p></div>
        <button type="button" onClick={refresh}>Refresh</button>
      </div>
      {error && <p role="alert" className="diagnostics-error">{error}</p>}
      <div className="diagnostics-summary" aria-live="polite">
        <div><span>MQTT</span><strong>{status ? (status.mqttConnected ? 'Connected' : 'Disconnected') : 'Loading'}</strong></div>
        <div><span>Uptime</span><strong>{status ? `${status.uptimeSeconds}s` : '—'}</strong></div>
        <div><span>Events retained</span><strong>{status?.journal?.count ?? '—'}</strong></div>
        <div><span>Last refresh</span><strong>{updated ? formatTime(updated) : '—'}</strong></div>
      </div>
      <h3>Persistence</h3>
      <div className="diagnostics-summary">
        <div><span>Primary history</span><strong>{status?.persistence?.primaryExists ? 'Present' : 'Not created'}</strong></div>
        <div><span>Backups</span><strong>{status?.persistence?.validBackups ?? '—'} valid / {status?.persistence?.backupCount ?? '—'} found</strong></div>
      </div>
      {status?.persistence?.backups?.some(backup => !backup.valid) && (
        <p role="alert" className="diagnostics-error">One or more history backups are invalid. Inspect storage before recovery.</p>
      )}
      <h3>Chargers</h3>
      <div className="diagnostics-grid">
        {status?.chargers?.length ? status.chargers.map(charger => (
          <article key={charger.id} className="diagnostics-card">
            <h4>{charger.name}</h4>
            <p>Relay: {charger.relayConfirmed ? (charger.isOn ? 'ON (confirmed)' : 'OFF (confirmed)') : 'Unconfirmed'}</p>
            <p>Session: {charger.processId ?? 'None'}</p>
            <p>Auto-off: {LABELS[charger.autoOff.reason] || charger.autoOff.reason}</p>
            {completion[charger.id] && <div className="diagnostics-assessment">
              <p>Completion evidence: {completion[charger.id].assessment.reason.replaceAll('_', ' ')}</p>
              <p>Detector comparison: {completion[charger.id].comparison.agrees ? 'Agrees' : 'Differs'} (existing: {completion[charger.id].comparison.legacyReady ? 'ready' : 'not ready'}, advisory: {completion[charger.id].assessment.ready ? 'ready' : 'not ready'})</p>
              <small>Advisory only — does not control auto-off</small>
            </div>}
            {charger.autoOff.sampleAgeMs != null && <p>Last sample age: {Math.round(charger.autoOff.sampleAgeMs / 1000)}s</p>}
          </article>
        )) : <p>No charger state available.</p>}
      </div>
      <h3>Appliances</h3>
      <div className="diagnostics-grid">
        {status?.appliances?.length ? status.appliances.map(appliance => (
          <article key={appliance.id} className="diagnostics-card">
            <h4>{appliance.name}</h4>
            <p>Cycle: {appliance.isRunning ? 'Running' : 'Idle'}</p>
            <p>Telemetry: {appliance.telemetryConfirmed ? 'Confirmed' : 'Unconfirmed'}</p>
            <p>Session: {appliance.processId ?? 'None'}</p>
          </article>
        )) : <p>No appliance state available.</p>}
      </div>
      <div className="diagnostics-heading">
        <h3>Recent events</h3>
        <label>Filter <select value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="">All events</option>
          {types.map(type => <option key={type} value={type}>{type}</option>)}
        </select></label>
      </div>
      <div className="diagnostics-events">
        {visibleEvents.length ? [...visibleEvents].reverse().map(event => (
          <div className="diagnostics-event" key={event.id}>
            <time dateTime={event.timestamp}>{formatTime(event.timestamp)}</time>
            <strong>{event.type.replaceAll('_', ' ')}</strong>
            <span>{Object.entries(event.details || {}).map(([key, value]) => `${key}: ${value}`).join(' · ')}</span>
          </div>
        )) : <p>No events recorded.</p>}
      </div>
      <p className="diagnostics-note">Events are kept in memory and reset on backend restart.</p>
    </section>
  );
}
