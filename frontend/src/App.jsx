import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import axios from 'axios';
import Navigation from './components/Navigation';
import ChargingPage from './pages/ChargingPage';
import DevicePage from './pages/DevicePage';
import StatisticsPage from './pages/StatisticsPage';
import { useTheme } from './contexts/ThemeContext';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL || '/api';

function App() {
  const { theme, toggleTheme } = useTheme();
  const [devices, setDevices] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [patterns, setPatterns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const [devicesRes, processesRes, patternsRes] = await Promise.all([
        axios.get(`${API_URL}/devices`),
        axios.get(`${API_URL}/processes`),
        axios.get(`${API_URL}/patterns`)
      ]);
      
      setDevices(devicesRes.data);
      setProcesses(processesRes.data);
      setPatterns(patternsRes.data);
      
      setLoading(false);
      setError(null);
    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Failed to connect to backend. Please check if the server is running.');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleProcessDelete = async (processId) => {
    try {
      await axios.delete(`${API_URL}/processes/${processId}`);
      setProcesses(processes.filter(p => p.id !== processId));
    } catch (err) {
      console.error('Error deleting process:', err);
      setError('Failed to delete process. Please try again.');
    }
  };

  const handleProcessCleanup = async (olderThanDays) => {
    const response = await axios.post(`${API_URL}/processes/cleanup`, { olderThanDays });
    await fetchData();
    return response.data.deletedCount;
  };

  const handleProcessComplete = async (processId) => {
    try {
      const response = await axios.put(`${API_URL}/processes/${processId}/complete`);
      setProcesses(processes.map(p => 
        p.id === processId ? response.data.process : p
      ));
      fetchData();
    } catch (err) {
      console.error('Error completing process:', err);
      setError('Failed to mark process as complete. Please try again.');
    }
  };

  const handlePatternUpdate = async (action, data) => {
    try {
      if (action === 'updateLabel') {
        const { patternId, newLabel, shouldRenameAll } = data;
        await axios.put(`${API_URL}/patterns/${patternId}/label`, {
          newLabel,
          shouldRenameAll
        });
        await fetchData();
      } else if (action === 'merge') {
        const { sourcePatternId, targetPatternId } = data;
        await axios.post(`${API_URL}/patterns/merge`, {
          sourcePatternId,
          targetPatternId
        });
        await fetchData();
      } else if (action === 'delete') {
        const { patternId } = data;
        await axios.delete(`${API_URL}/patterns/${patternId}`);
        await fetchData();
      } else if (action === 'rerun') {
        await axios.post(`${API_URL}/patterns/rerun`);
        await fetchData();
      } else if (action === 'create') {
        const { deviceName, chargerId } = data;
        await axios.post(`${API_URL}/patterns`, {
          deviceName,
          chargerId
        });
        await fetchData();
      }
    } catch (err) {
      console.error(`Error performing pattern action ${action}:`, err);
      if (err.response?.status === 409 && err.response?.data?.shouldMerge) {
        throw err;
      }
      throw new Error(err.response?.data?.error || 'Failed to update pattern');
    }
  };

  const handleProcessUpdate = async (action, data) => {
    try {
      if (action === 'updateDeviceName') {
        const { processId, newLabel } = data;
        await axios.put(`${API_URL}/processes/${processId}/device-name`, {
          newDeviceName: newLabel
        });
        await fetchData();
      }
    } catch (err) {
      console.error(`Error performing process action ${action}:`, err);
      throw new Error(err.response?.data?.error || 'Failed to update process');
    }
  };

  return (
    <Router>
      <div className="app">
        <header className="app-header">
          <button 
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
          <h1>🔌 Charging Monitor</h1>
          <span className="version-badge">v0.9.3</span>
        </header>

        <Navigation />

        <main className="app-main">
          {loading ? (
            <div className="loading">Loading...</div>
          ) : error ? (
            <div className="error">{error}</div>
          ) : (
            <Routes>
              <Route 
                path="/" 
                element={
                  <ChargingPage 
                    devices={devices}
                    processes={processes}
                    patterns={patterns}
                    onRefreshData={fetchData}
                  />
                } 
              />
              <Route 
                path="/devices" 
                element={
                  <DevicePage 
                    processes={processes}
                    patterns={patterns}
                    devices={devices}
                    onPatternUpdate={handlePatternUpdate}
                    onDeleteProcess={handleProcessDelete}
                    onCleanupProcesses={handleProcessCleanup}
                    onCompleteProcess={handleProcessComplete}
                    onProcessUpdate={handleProcessUpdate}
                  />
                } 
              />
              <Route 
                path="/statistics" 
                element={
                  <StatisticsPage 
                    processes={processes}
                    patterns={patterns}
                    devices={devices}
                  />
                } 
              />
            </Routes>
          )}
        </main>
      </div>
    </Router>
  );
}

export default App;
