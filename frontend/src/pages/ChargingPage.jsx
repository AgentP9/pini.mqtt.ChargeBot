import React, { useMemo, useState, useEffect } from 'react';
import axios from 'axios';
import DeviceList from '../components/DeviceList';
import ChargingChart from '../components/ChargingChart';
import { formatDateTime } from '../utils/dateFormatter';
import { calculateProcessEnergyWh } from '../utils/energy.mjs';
import './ChargingPage.css';

const API_URL = import.meta.env.VITE_API_URL || '/api';

function ChargingPage({ 
  devices, 
  processes,
  patterns,
  onRefreshData
}) {
  const [estimations, setEstimations] = useState({});
  const [guesses, setGuesses] = useState({});
  const [completionStatus, setCompletionStatus] = useState(null);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  // Get active (currently running) charging processes
  const activeProcesses = useMemo(() => {
    return processes.filter(process => !process.endTime);
  }, [processes]);

  // Track active process IDs to prevent unnecessary effect re-runs
  const activeProcessIds = useMemo(() => {
    return activeProcesses.map(p => p.id).join(',');
  }, [activeProcesses]);

  // Fetch completion time estimates for active processes
  useEffect(() => {
    if (activeProcesses.length === 0) {
      setEstimations({});
      return;
    }

    const fetchEstimates = async () => {
      const newEstimations = {};
      await Promise.all(
        activeProcesses.map(async (process) => {
          try {
            const response = await axios.get(`${API_URL}/processes/${process.id}/estimate`);
            if (response.data.hasEstimate) {
              newEstimations[process.id] = response.data;
            }
          } catch (error) {
            console.error(`Error fetching estimate for process ${process.id}:`, error);
          }
        })
      );
      setEstimations(newEstimations);
    };

    fetchEstimates();
    // Refresh estimates every 30 seconds
    const interval = setInterval(fetchEstimates, 30000);
    return () => clearInterval(interval);
  }, [activeProcessIds, activeProcesses]);

  // Fetch device guesses for active processes
  useEffect(() => {
    if (activeProcesses.length === 0) {
      setGuesses({});
      return;
    }

    const fetchGuesses = async () => {
      const newGuesses = {};
      await Promise.all(
        activeProcesses.map(async (process) => {
          try {
            const response = await axios.get(`${API_URL}/processes/${process.id}/guess`);
            if (response.data.hasGuess) {
              newGuesses[process.id] = {
                deviceName: response.data.guessedDevice,
                patternId: response.data.patternId,
                confidence: response.data.confidence,
                cycled: response.data.cycled
              };
            }
          } catch (error) {
            console.error(`Error fetching guess for process ${process.id}:`, error);
          }
        })
      );
      setGuesses(newGuesses);
    };

    fetchGuesses();
    // Refresh guesses every 10 seconds
    const interval = setInterval(fetchGuesses, 10000);
    return () => clearInterval(interval);
  }, [activeProcesses]);

  // Fetch completion status for the single active process
  useEffect(() => {
    if (activeProcesses.length !== 1) {
      setCompletionStatus(null);
      return;
    }

    const fetchCompletionStatus = async () => {
      const process = activeProcesses[0];
      const chargerId = process.chargerId || process.deviceId;
      
      if (!chargerId) {
        return;
      }

      try {
        const response = await axios.get(`${API_URL}/chargers/${chargerId}/completion-status`);
        setCompletionStatus(response.data);
      } catch (error) {
        console.error(`Error fetching completion status for charger ${chargerId}:`, error);
      }
    };

    fetchCompletionStatus();
    // Refresh completion status every 30 seconds
    const interval = setInterval(fetchCompletionStatus, 30000);
    return () => clearInterval(interval);
  }, [activeProcesses]);

  const handleConfirmGuess = async (processId, guessedDeviceName) => {
    try {
      await axios.put(`${API_URL}/processes/${processId}/device-name`, {
        newDeviceName: guessedDeviceName
      });
      
      // Remove the guess from state since it's now confirmed
      setGuesses(prev => {
        const updated = { ...prev };
        delete updated[processId];
        return updated;
      });
      
      // Refresh data to show the confirmed device name
      if (onRefreshData) {
        await onRefreshData();
      }
    } catch (error) {
      console.error(`Error confirming guess for process ${processId}:`, error);
      alert('Failed to confirm device guess. Please try again.');
    }
  };

  const handleRejectGuess = async (processId, patternId) => {
    try {
      const response = await axios.post(`${API_URL}/processes/${processId}/reject-guess`, {
        rejectedPatternId: patternId
      });
      
      if (response.data.hasGuess) {
        // Update the guess with the next suggestion
        setGuesses(prev => ({
          ...prev,
          [processId]: {
            deviceName: response.data.guessedDevice,
            patternId: response.data.patternId,
            confidence: response.data.confidence,
            cycled: response.data.cycled,
            totalMatches: response.data.totalMatches
          }
        }));
      } else {
        // No more guesses available
        setGuesses(prev => {
          const updated = { ...prev };
          delete updated[processId];
          return updated;
        });
      }
    } catch (error) {
      console.error(`Error rejecting guess for process ${processId}:`, error);
      alert('Failed to reject device guess. Please try again.');
    }
  };

  const formatRemainingTime = (minutes) => {
    if (minutes < 1) {
      return 'Less than 1 minute';
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
  };

  return (
    <div className="charging-page smart-dashboard">
      <header className="dashboard-intro">
        <div><p className="dashboard-eyebrow">CHARGEBOT · HOME</p><h2>Charging overview</h2><p>Everything important at a glance. Technical details when you need them.</p></div>
        <button className="dashboard-details-toggle" type="button" aria-expanded={showTechnicalDetails} onClick={() => setShowTechnicalDetails(value => !value)}>{showTechnicalDetails ? 'Hide technical details' : 'Show technical details'}</button>
      </header>
      <section className="dashboard-summary" aria-label="Charging summary">
        <article className="dashboard-metric"><span>Active sessions</span><strong>{activeProcesses.length}</strong><small>{activeProcesses.length ? 'Charging in progress' : 'All quiet'}</small></article>
        <article className="dashboard-metric"><span>Current power</span><strong>{devices.reduce((total, d) => total + (Number.isFinite(d.power) && d.isOn ? Math.max(0, d.power) : 0), 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} <em>W</em></strong><small>Across connected chargers</small></article>
        <article className="dashboard-metric"><span>Energy today</span><strong>{(processes.filter(p => p.startTime && new Date(p.startTime).toDateString() === new Date().toDateString()).reduce((total, p) => total + calculateProcessEnergyWh(p), 0) / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} <em>kWh</em></strong><small>Sessions started today · estimated</small></article>
      </section>
      <section className="card devices-section-full smart-devices">
        <h2>My chargers</h2>
        <DeviceList 
          devices={devices}
          processes={processes}
          patterns={patterns}
          selectedDeviceId={null}
          onSelectDevice={() => {}}
          onRefreshData={onRefreshData}
        />
      </section>

      {activeProcesses.length > 0 && (
        <section className="card chart-section smart-chart">
          <div className="chart-header">
            <h2>
              {activeProcesses.length === 1 
                ? `Live charging`
                : `Live charging (${activeProcesses.length} sessions)`
              }
            </h2>
          </div>
          
          {/* Individual process information for each active process */}
          {activeProcesses.map((process) => {
            const processId = process.id;
            const guess = guesses[processId];
            const estimation = estimations[processId];
            const hasDeviceName = process.deviceName && process.deviceName.trim() !== '';
            
            return (
              <div key={processId} className={`process-info ${showTechnicalDetails ? "" : "dashboard-compact-process"}`} style={{ marginBottom: activeProcesses.length > 1 ? '1.5rem' : '0' }}>
                {showTechnicalDetails && activeProcesses.length > 1 && (
                  <div className="info-item">
                    <strong>Process:</strong> #{processId}
                  </div>
                )}
                <div className="info-item">
                  <strong>Charger:</strong> {process.chargerName || process.deviceName || process.chargerId || process.deviceId}
                </div>
                {showTechnicalDetails && <div className="info-item">
                  <strong>Start:</strong> {formatDateTime(process.startTime)}
                </div>}
                {guess && !hasDeviceName && (
                  <div className="info-item guess-item">
                    <strong>Device Guess:</strong>{' '}
                    <span className="guess-value">
                      {guess.deviceName}
                    </span>
                    <span className="guess-confidence">
                      ({Math.round(guess.confidence * 100)}% match)
                    </span>
                    {guess.cycled && (
                      <span className="guess-cycled" title="All options have been shown, cycling back">
                        🔄
                      </span>
                    )}
                    <div className="guess-buttons">
                      <button
                        className="confirm-guess-button"
                        onClick={() => handleConfirmGuess(processId, guess.deviceName)}
                        title="Confirm this device identification"
                      >
                        &#10003;
                      </button>
                      <button
                        className="reject-guess-button"
                        onClick={() => handleRejectGuess(processId, guess.patternId)}
                        title="Reject and show next best match"
                      >
                        &#10005;
                      </button>
                    </div>
                  </div>
                )}
                {!guess && !hasDeviceName && (
                  <div className="info-item unknown-device-hint">
                    <strong>Device:</strong>{' '}
                    <span className="unknown-value">Unknown device</span>
                    <small style={{ display: 'block', marginTop: '0.25rem', color: 'var(--text-muted)' }}>
                      Continue charging to allow device recognition
                    </small>
                  </div>
                )}
                {estimation && (
                  <>
                    <div className="info-item estimate-item">
                      <strong>Remaining:</strong>{' '}
                      <span className="estimate-value">
                        {estimation.status === 'completing' ? (
                          'Completing...'
                        ) : (
                          formatRemainingTime(estimation.remainingMinutes)
                        )}
                      </span>
                      <span className="estimate-confidence">
                        ({Math.round(estimation.confidence * 100)}% confidence
                        {estimation.patternDeviceName && `, based on ${estimation.patternDeviceName}`})
                      </span>
                    </div>
                    {estimation.patternDeviceName && !hasDeviceName && (
                      <div className="info-item estimate-hint">
                        <small>Confirm or reject device identification:</small>
                        <div className="guess-buttons">
                          <button
                            className="confirm-guess-button"
                            onClick={() => handleConfirmGuess(processId, estimation.patternDeviceName)}
                            title="Confirm this device identification"
                          >
                            &#10003;
                          </button>
                          {estimation.patternId && (
                            <button
                              className="reject-guess-button"
                              onClick={() => handleRejectGuess(processId, estimation.patternId)}
                              title="Reject and show next best match"
                            >
                              &#10005;
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
          
          <ChargingChart 
            processes={activeProcesses} 
            completionStatus={activeProcesses.length === 1 ? completionStatus : null}
          />
        </section>
      )}

      {activeProcesses.length === 0 && (
        <section className="card empty-charging-section">
          <div className="empty-state">
            <p>No active charging processes</p>
          </div>
        </section>
      )}
    </div>
  );
}

export default ChargingPage;
