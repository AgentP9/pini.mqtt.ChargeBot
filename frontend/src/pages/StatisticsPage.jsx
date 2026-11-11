import React, { useMemo, useState } from 'react';
import axios from 'axios';
import { BarChart, Bar, LineChart, Line, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { formatDateTime } from '../utils/dateFormatter';
import { calculateProcessEnergyWh } from '../utils/energy.mjs';
import './StatisticsPage.css';

function StatisticsPage({ processes, patterns, devices }) {
  const [exporting, setExporting] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [exportLimit, setExportLimit] = useState('20');
  const candidates = useMemo(() => processes.filter(p => p.endTime && p.processType !== 'appliance' && Array.isArray(p.events) && p.events.filter(e => e.type === 'power_consumption').length >= 20).sort((a, b) => new Date(b.startTime) - new Date(a.startTime)).slice(0, 100), [processes]);
  const exportIds = selectedIds.filter(id => candidates.some(p => p.id === id));
  const [exportError, setExportError] = useState('');
  const [exportSummary, setExportSummary] = useState('');

  const downloadReplayExport = async () => {
    setExporting(true);
    setExportError('');
    setExportSummary('');
    try {
      const ids = exportIds.length ? exportIds : candidates.slice(0, Number(exportLimit)).map(p => p.id);
      if (!ids.length) throw new Error('No eligible completed sessions available');
      const response = await axios.get(`${import.meta.env.VITE_API_URL || '/api'}/processes/replay-export`, { params: { ids: ids.join(',') }, timeout: 30000 });
      const { traces, skipped } = response.data;
      if (!Array.isArray(traces)) throw new Error('Unexpected export response');
      const blob = new Blob([JSON.stringify(traces, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = 'chargebot-replay-candidates.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setExportSummary(`${traces.length} anonymized candidates exported; ${Object.values(skipped || {}).reduce((a, b) => a + b, 0)} skipped. Independent labels are required before validation.`);
    } catch (error) {
      setExportError(error.response?.data?.error || error.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  // Calculate statistics from processes and patterns
  const statistics = useMemo(() => {
    // Total processes
    const totalProcesses = processes.length;
    const completedProcesses = processes.filter(p => p.endTime).length;
    const activeProcesses = totalProcesses - completedProcesses;
    
    // Average duration (in minutes)
    const completedWithDuration = processes.filter(p => p.endTime && p.startTime);
    const averageDuration = completedWithDuration.length > 0
      ? completedWithDuration.reduce((sum, p) => {
          const duration = (new Date(p.endTime) - new Date(p.startTime)) / (1000 * 60);
          return sum + duration;
        }, 0) / completedWithDuration.length
      : 0;
    
    // Sum energy from timestamped MQTT samples (Wh).
    const totalEnergy = processes.reduce((sum, p) => sum + calculateProcessEnergyWh(p), 0);

    // Device usage count (by pattern)
    const deviceUsage = {};
    patterns.forEach(pattern => {
      deviceUsage[pattern.deviceName] = pattern.count || 0;
    });
    
    // Charger usage count with friendly names
    // Create a mapping from charger IDs to names
    const chargerIdToName = {};
    devices.forEach(device => {
      chargerIdToName[device.id] = device.name;
    });
    
    const chargerUsage = {};
    processes.forEach(p => {
      const chargerId = p.chargerId || p.deviceId || 'Unknown';
      // Use the friendly name if available, otherwise use the ID
      const chargerName = chargerIdToName[chargerId] || chargerId;
      chargerUsage[chargerName] = (chargerUsage[chargerName] || 0) + 1;
    });
    
    // Processes per day (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const processesPerDay = {};
    processes.forEach(p => {
      const date = new Date(p.startTime);
      if (date >= thirtyDaysAgo) {
        const dateKey = date.toISOString().split('T')[0];
        processesPerDay[dateKey] = (processesPerDay[dateKey] || 0) + 1;
      }
    });
    
    // Fill missing dates with 0
    const dateArray = [];
    for (let d = new Date(thirtyDaysAgo); d <= new Date(); d.setDate(d.getDate() + 1)) {
      const dateKey = d.toISOString().split('T')[0];
      dateArray.push({
        date: dateKey,
        count: processesPerDay[dateKey] || 0
      });
    }
    
    // Peak charging hours (by hour of day)
    const chargingByHour = {};
    for (let i = 0; i < 24; i++) {
      chargingByHour[i] = 0;
    }
    
    processes.forEach(p => {
      const hour = new Date(p.startTime).getHours();
      chargingByHour[hour] += 1;
    });
    
    const peakHoursData = Object.entries(chargingByHour).map(([hour, count]) => ({
      hour: parseInt(hour),
      count,
      label: `${hour.toString().padStart(2, '0')}:00`
    }));
    
    return {
      totalProcesses,
      completedProcesses,
      activeProcesses,
      averageDuration,
      totalEnergy,
      deviceUsage,
      chargerUsage,
      processesPerDay: dateArray,
      peakHoursData
    };
  }, [processes, patterns, devices]);
  
  // Prepare data for charts
  const deviceUsageData = Object.entries(statistics.deviceUsage)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10); // Top 10 devices
  
  const chargerUsageData = Object.entries(statistics.chargerUsage)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  
  const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
  
  return (
    <div className="statistics-page">
      <h2 className="page-title">📊 Charging Statistics</h2>
      <section className="replay-export-panel" aria-label="Charging history export">
        <h3>Completion validation export</h3>
        <p>Download anonymized charging power histories for offline validation (Sprint 7). Device names and IDs are removed and timestamps are shifted. Completed sessions are not automatically considered fully charged.</p>
        <div className="export-controls">
          <label htmlFor="export-limit">Default export size</label>
          <select id="export-limit" value={exportLimit} onChange={e => setExportLimit(e.target.value)} disabled={exporting || exportIds.length > 0}>
            <option value="10">Latest 10</option><option value="20">Latest 20</option><option value="50">Latest 50</option><option value="100">Latest 100</option>
          </select>
          <span>{exportIds.length ? `${exportIds.length} selected` : 'Or select specific sessions below'}</span>
        </div>
        <details className="export-session-picker">
          <summary>Select individual completed sessions ({candidates.length} eligible shown)</summary>
          <div className="export-picker-actions"><button type="button" onClick={() => setSelectedIds(candidates.map(p => p.id))}>Select all shown</button><button type="button" onClick={() => setSelectedIds([])}>Clear selection</button></div>
          <div className="export-session-list">{candidates.map(p => <label key={p.id}><input type="checkbox" checked={exportIds.includes(p.id)} onChange={e => setSelectedIds(current => e.target.checked ? [...current, p.id] : current.filter(id => id !== p.id))} /><span>Session #{p.id} · {formatDateTime(p.startTime)} · {p.deviceName || p.chargerName || 'Unknown device'}</span></label>)}</div>
        </details>
        <button type="button" disabled={exporting || candidates.length === 0} onClick={downloadReplayExport}>
          {exporting ? 'Preparing export…' : 'Export anonymized replay JSON'}
        </button>
        {exportSummary && <p role="status">{exportSummary}</p>}
        {exportError && <p role="alert">Export failed: {exportError}</p>}
      </section>
      
      {/* Summary Cards */}
      <div className="stats-summary">
        <div className="stat-card">
          <div className="stat-icon">⚡</div>
          <div className="stat-content">
            <div className="stat-label">Total Sessions</div>
            <div className="stat-value">{statistics.totalProcesses}</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <div className="stat-label">Completed</div>
            <div className="stat-value">{statistics.completedProcesses}</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">🔄</div>
          <div className="stat-content">
            <div className="stat-label">Active</div>
            <div className="stat-value">{statistics.activeProcesses}</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">⏱️</div>
          <div className="stat-content">
            <div className="stat-label">Avg Duration</div>
            <div className="stat-value">
              {statistics.averageDuration > 0 
                ? `${Math.round(statistics.averageDuration)} min`
                : 'N/A'
              }
            </div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">🔋</div>
          <div className="stat-content">
            <div className="stat-label">Total Energy</div>
            <div className="stat-value">
              {statistics.totalEnergy > 0 
                ? `${(statistics.totalEnergy / 1000).toFixed(2)} kWh`
                : 'N/A'
              }
            </div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">📱</div>
          <div className="stat-content">
            <div className="stat-label">Recognized Devices</div>
            <div className="stat-value">{patterns.length}</div>
          </div>
        </div>
      </div>
      
      {/* Charts Grid */}
      <div className="charts-grid">
        {/* Charging Sessions Over Time */}
        <div className="card chart-card">
          <h3>Charging Sessions (Last 30 Days)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={statistics.processesPerDay}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
              <XAxis 
                dataKey="date" 
                stroke="var(--text-tertiary)"
                tick={{ fill: 'var(--text-tertiary)', fontSize: 12 }}
                tickFormatter={(value) => {
                  const date = new Date(value);
                  return `${date.getMonth() + 1}/${date.getDate()}`;
                }}
              />
              <YAxis 
                stroke="var(--text-tertiary)"
                tick={{ fill: 'var(--text-tertiary)', fontSize: 12 }}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'var(--bg-secondary)', 
                  border: '1px solid var(--border-primary)',
                  borderRadius: '6px'
                }}
                labelFormatter={(value) => {
                  const date = new Date(value);
                  return date.toLocaleDateString();
                }}
              />
              <Line 
                type="monotone" 
                dataKey="count" 
                stroke="#10b981" 
                strokeWidth={2}
                dot={{ fill: '#10b981', r: 4 }}
                activeDot={{ r: 6 }}
                name="Sessions"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        
        {/* Device Usage */}
        {deviceUsageData.length > 0 && (
          <div className="card chart-card">
            <h3>Most Charged Devices</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={deviceUsageData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
                <XAxis 
                  dataKey="name" 
                  stroke="var(--text-tertiary)"
                  tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis 
                  stroke="var(--text-tertiary)"
                  tick={{ fill: 'var(--text-tertiary)', fontSize: 12 }}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'var(--bg-secondary)', 
                    border: '1px solid var(--border-primary)',
                    borderRadius: '6px'
                  }}
                />
                <Bar dataKey="count" name="Sessions">
                  {deviceUsageData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        
        {/* Peak Charging Hours */}
        <div className="card chart-card">
          <h3>Peak Charging Hours</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={statistics.peakHoursData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
              <XAxis 
                dataKey="label" 
                stroke="var(--text-tertiary)"
                tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                angle={-45}
                textAnchor="end"
                height={60}
              />
              <YAxis 
                stroke="var(--text-tertiary)"
                tick={{ fill: 'var(--text-tertiary)', fontSize: 12 }}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'var(--bg-secondary)', 
                  border: '1px solid var(--border-primary)',
                  borderRadius: '6px'
                }}
                labelFormatter={(label) => `Time: ${label}`}
              />
              <Bar dataKey="count" fill="#8b5cf6" name="Sessions" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        
        {/* Charger Usage */}
        {chargerUsageData.length > 0 && (
          <div className="card chart-card">
            <h3>Charger Usage</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chargerUsageData} margin={{ bottom: 80 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
                <XAxis 
                  dataKey="name" 
                  stroke="var(--text-tertiary)"
                  tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                  angle={-45}
                  textAnchor="end"
                />
                <YAxis 
                  stroke="var(--text-tertiary)"
                  tick={{ fill: 'var(--text-tertiary)', fontSize: 12 }}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'var(--bg-secondary)', 
                    border: '1px solid var(--border-primary)',
                    borderRadius: '6px'
                  }}
                />
                <Bar dataKey="count" fill="#3b82f6" name="Sessions" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      
      {statistics.totalProcesses === 0 && (
        <div className="empty-state">
          <p>No charging data available yet. Start charging some devices to see statistics!</p>
        </div>
      )}
    </div>
  );
}

export default StatisticsPage;
