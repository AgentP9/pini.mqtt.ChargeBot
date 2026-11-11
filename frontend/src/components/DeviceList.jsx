import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './DeviceList.css';

const API_URL = import.meta.env.VITE_API_URL || '/api';

// DeviceList displays connected chargers (physical charging devices like ShellyPlugs)
function DeviceList({ devices, processes, patterns, selectedDeviceId, onSelectDevice, onRefreshData }) {
  const [deviceGuesses, setDeviceGuesses] = useState({});
  const [completionStatus, setCompletionStatus] = useState({});
  const [controllingDevice, setControllingDevice] = useState(null);
  const [selectingDevice, setSelectingDevice] = useState(null); // Track which charger is showing the selector

  // Fetch educated guesses for active processes
  useEffect(() => {
    // Check for active devices first to avoid unnecessary work
    const activeDevices = devices.filter(d => d.isOn && d.currentProcessId !== null);
    
    if (activeDevices.length === 0) {
      setDeviceGuesses({});
      return; // No interval needed
    }
    
    const fetchGuesses = async () => {
      const guesses = {};
      await Promise.all(
        activeDevices.map(async (device) => {
          try {
            const response = await axios.get(`${API_URL}/processes/${device.currentProcessId}/guess`);
            if (response.data.hasGuess) {
              guesses[device.id] = {
                deviceName: response.data.guessedDevice,
                patternId: response.data.patternId,
                confidence: response.data.confidence,
                cycled: response.data.cycled
              };
            }
          } catch (error) {
            console.error(`Error fetching guess for device ${device.id}:`, error);
          }
        })
      );
      
      setDeviceGuesses(guesses);
    };
    
    fetchGuesses();
    // Refresh guesses every 10 seconds while there are active devices
    const interval = setInterval(fetchGuesses, 10000);
    return () => clearInterval(interval);
  }, [devices]);

  // Fetch completion status for active chargers
  useEffect(() => {
    const activeDevices = devices.filter(d => d.isOn && d.currentProcessId !== null);
    
    if (activeDevices.length === 0) {
      setCompletionStatus({});
      return; // No interval to clean up
    }
    
    const fetchCompletionStatus = async () => {
      const statuses = {};
      await Promise.all(
        activeDevices.map(async (device) => {
          try {
            const response = await axios.get(`${API_URL}/chargers/${device.id}/completion-status`);
            if (response.data.isActive) {
              statuses[device.id] = response.data.isInCompletionPhase;
            }
          } catch (error) {
            console.error(`Error fetching completion status for charger ${device.id}:`, error);
          }
        })
      );
      
      setCompletionStatus(statuses);
    };
    
    fetchCompletionStatus();
    // Refresh completion status every 30 seconds
    const completionInterval = setInterval(fetchCompletionStatus, 30000);
    return () => clearInterval(completionInterval);
  }, [devices]);

  if (devices.length === 0) {
    return <div className="empty-state">No chargers configured</div>;
  }

  const handleDeviceClick = (deviceId) => {
    // If clicking the already selected charger, deselect it
    if (selectedDeviceId === deviceId) {
      onSelectDevice(null);
    } else {
      onSelectDevice(deviceId);
    }
  };

  const handleToggleCharger = async (deviceId, currentState, event) => {
    // Prevent the click from bubbling to the device selection
    event.stopPropagation();
    
    const newState = currentState ? 'off' : 'on';
    
    setControllingDevice(deviceId);
    
    try {
      // Enforce minimum 1 second delay for spinner visibility
      await Promise.all([
        axios.post(`${API_URL}/chargers/${deviceId}/control`, {
          state: newState
        }),
        new Promise(resolve => setTimeout(resolve, 1000))
      ]);
      console.log(`Successfully sent ${newState} command to charger ${deviceId}`);
      
      // Immediately refresh data to show new state
      if (onRefreshData) {
        await onRefreshData();
      }
    } catch (error) {
      console.error(`Error controlling charger ${deviceId}:`, error);
      const errorMessage = error.response?.data?.error || `Failed to ${newState} charger`;
      alert(`${errorMessage}. Please try again.`);
    } finally {
      setControllingDevice(null);
    }
  };

  const handleConfirmGuess = async (deviceId, processId, guessedDeviceName, event) => {
    event.stopPropagation();
    
    try {
      await axios.post(`${API_URL}/processes/${processId}/confirm-guess`, {
        guessedDeviceName
      });
      
      // Remove the guess from state since it's been confirmed
      setDeviceGuesses(prev => {
        const updated = { ...prev };
        delete updated[deviceId];
        return updated;
      });
      
      // Refresh data to show updated device name
      if (onRefreshData) {
        await onRefreshData();
      }
    } catch (error) {
      console.error(`Error confirming guess for process ${processId}:`, error);
      const errorMessage = error.response?.data?.error || 'Failed to confirm device guess';
      alert(`${errorMessage}. Please try again.`);
    }
  };

  const handleRejectGuess = async (deviceId, processId, patternId, event) => {
    event.stopPropagation();
    
    try {
      const response = await axios.post(`${API_URL}/processes/${processId}/reject-guess`, {
        rejectedPatternId: patternId
      });
      
      if (response.data.hasGuess) {
        // Update the guess with the next suggestion
        setDeviceGuesses(prev => ({
          ...prev,
          [deviceId]: {
            deviceName: response.data.guessedDevice,
            patternId: response.data.patternId,
            confidence: response.data.confidence,
            cycled: response.data.cycled
          }
        }));
      } else {
        // No more guesses available, remove from state
        setDeviceGuesses(prev => {
          const updated = { ...prev };
          delete updated[deviceId];
          return updated;
        });
      }
    } catch (error) {
      console.error(`Error rejecting guess for process ${processId}:`, error);
      const errorMessage = error.response?.data?.error || 'Failed to reject device guess';
      alert(`${errorMessage}. Please try again.`);
    }
  };

  const handleManualDeviceSelect = async (deviceId, processId, selectedDeviceName, event) => {
    event.stopPropagation();
    
    if (!selectedDeviceName) {
      return;
    }
    
    try {
      await axios.put(`${API_URL}/processes/${processId}/device-name`, {
        newDeviceName: selectedDeviceName
      });
      
      // Remove the guess from state since device is now set
      setDeviceGuesses(prev => {
        const updated = { ...prev };
        delete updated[deviceId];
        return updated;
      });
      
      // Close the selector
      setSelectingDevice(null);
      
      // Refresh data to show updated device name
      if (onRefreshData) {
        await onRefreshData();
      }
    } catch (error) {
      console.error(`Error setting device for process ${processId}:`, error);
      const errorMessage = error.response?.data?.error || 'Failed to set device';
      alert(`${errorMessage}. Please try again.`);
    }
  };

  const toggleDeviceSelector = (deviceId, event) => {
    event.stopPropagation();
    setSelectingDevice(selectingDevice === deviceId ? null : deviceId);
  };

  return (
    <div className="device-list">
      {devices.map(device => {
        const guess = deviceGuesses[device.id];
        const isCompleting = completionStatus[device.id] === true;
        const isSelectable = onSelectDevice && typeof onSelectDevice === 'function' && selectedDeviceId !== undefined;
        
        // Find the current process for this device to get the assigned device name
        const currentProcess = processes && device.currentProcessId 
          ? processes.find(p => p.id === device.currentProcessId)
          : null;
        const assignedDeviceName = currentProcess?.deviceName;
        
        // Helper to determine if device selector should be shown
        const shouldShowDeviceSelector = device.isOn 
          && device.currentProcessId !== null 
          && !assignedDeviceName 
          && patterns 
          && patterns.length > 0;
        
        return (
        <div 
          key={device.id} 
          className={`device-item ${selectedDeviceId === device.id ? 'selected' : ''} ${
            isCompleting ? 'device-completing' : (device.isOn ? 'device-on' : 'device-off')
          } ${isSelectable ? 'selectable' : ''}`}
          onClick={isSelectable ? () => handleDeviceClick(device.id) : undefined}
          role={isSelectable ? "button" : undefined}
          tabIndex={isSelectable ? 0 : undefined}
          onKeyDown={isSelectable ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleDeviceClick(device.id);
            }
          } : undefined}
          aria-pressed={isSelectable ? selectedDeviceId === device.id : undefined}
          aria-label={isSelectable ? `Select ${device.name}` : undefined}
        >
          <div className="smart-device-status" role="status">
            <span className={`smart-status-dot ${isCompleting ? 'completing' : device.isOn ? 'active' : 'idle'}`} aria-hidden="true" />
            {isCompleting ? 'Completion phase' : device.isOn ? (Number(device.power) > 5 ? 'Charging' : 'Switched on') : 'Switched off'}
          </div>
          <div className="device-header">
            <h3 className="device-name">{device.name}</h3>
            <div className="device-header-right">
              <div 
                className={`toggle-switch ${
                  isCompleting ? 'toggle-completing' : (device.isOn ? 'toggle-on' : 'toggle-off')
                } ${controllingDevice === device.id ? 'toggle-loading' : ''}`}
                onClick={(e) => {
                  if (controllingDevice !== device.id) {
                    handleToggleCharger(device.id, device.isOn, e);
                  } else {
                    e.stopPropagation();
                  }
                }}
                role="switch"
                aria-checked={device.isOn}
                aria-disabled={controllingDevice === device.id}
                aria-label={device.isOn ? 'Turn off charger' : 'Turn on charger'}
                tabIndex={0}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && controllingDevice !== device.id) {
                    e.preventDefault();
                    handleToggleCharger(device.id, device.isOn, e);
                  }
                }}
              >
                {controllingDevice === device.id ? (
                  <div className="toggle-track">
                    <span className="spinner toggle-spinner"></span>
                  </div>
                ) : (
                  <>
                    <div className="toggle-track"></div>
                    <div className="toggle-thumb"></div>
                    <span className="toggle-label">{device.isOn ? 'ON' : 'OFF'}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="device-details">
            <div className="detail-row">
              <span className="detail-label">Current power</span>
              <span className="detail-value">
                {device.isOn && device.power > 0 ? `${device.power.toFixed(2)} W` : '0.00 W'}
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Session</span>
              <span className="detail-value">
                {device.currentProcessId !== null ? `#${device.currentProcessId}` : '-'}
              </span>
            </div>
            {assignedDeviceName && (
              <div className="detail-row assigned-device-row">
                <span className="detail-label">Recognized device</span>
                <span className="detail-value assigned-device-value">
                  {assignedDeviceName}
                </span>
              </div>
            )}
            {guess && !assignedDeviceName && (
              <div className="detail-row guess-row">
                <span className="detail-label">Likely Device:</span>
                <span className="detail-value guess-value">
                  {guess.deviceName} 
                  <span className="confidence-badge">
                    {Math.round(guess.confidence * 100)}%
                  </span>
                  {guess.cycled && (
                    <span className="guess-cycled" title="All options have been shown, cycling back">
                      🔄
                    </span>
                  )}
                </span>
                <div className="guess-buttons">
                  <button
                    className="confirm-guess-button"
                    onClick={(e) => handleConfirmGuess(device.id, device.currentProcessId, guess.deviceName, e)}
                    title="Confirm this device identification"
                  >
                    ✓
                  </button>
                  <button
                    className="reject-guess-button"
                    onClick={(e) => handleRejectGuess(device.id, device.currentProcessId, guess.patternId, e)}
                    title="Reject and show next best match"
                  >
                    ✗
                  </button>
                </div>
              </div>
            )}
            {shouldShowDeviceSelector && (
              <div className="detail-row device-selector-row">
                <span className="detail-label">Set Device:</span>
                <div className="device-selector-container">
                  {selectingDevice === device.id ? (
                    <div className="device-selector-dropdown">
                      <select
                        className="device-selector"
                        onChange={(e) => handleManualDeviceSelect(device.id, device.currentProcessId, e.target.value, e)}
                        onClick={(e) => e.stopPropagation()}
                        defaultValue=""
                      >
                        <option value="" disabled>Select a device...</option>
                        {patterns.map((pattern) => (
                          <option key={pattern.id} value={pattern.deviceName}>
                            {pattern.deviceName} ({pattern.count} sessions)
                          </option>
                        ))}
                      </select>
                      <button
                        className="cancel-selector-button"
                        onClick={(e) => toggleDeviceSelector(device.id, e)}
                        title="Cancel selection"
                      >
                        ✗
                      </button>
                    </div>
                  ) : (
                    <button
                      className="show-selector-button"
                      onClick={(e) => toggleDeviceSelector(device.id, e)}
                      title="Manually select device"
                    >
                      📋 Select Device
                    </button>
                  )}
                </div>
              </div>
            )}
            <div className="device-actions">
              <button 
                className={`auto-off-button ${device.autoOffEnabled ? 'auto-off-active' : ''}`}
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    const endpoint = device.autoOffEnabled ? 'disable' : 'enable';
                    await axios.post(`${API_URL}/chargers/${device.id}/auto-off/${endpoint}`);
                    
                    // Refresh data to show updated state
                    if (onRefreshData) {
                      await onRefreshData();
                    }
                  } catch (error) {
                    console.error(`Error toggling auto-off for charger ${device.id}:`, error);
                    alert(`Failed to ${device.autoOffEnabled ? 'disable' : 'enable'} Auto OFF. Please try again.`);
                  }
                }}
                title={device.autoOffEnabled 
                  ? "Auto OFF is enabled - will turn off charger after 10 minutes of completion" 
                  : "Automatically turn off charger when device is fully charged"}
              >
                ⏰ Auto OFF {device.autoOffEnabled ? '✓' : ''}
              </button>
            </div>
          </div>
        </div>
      );
      })}
    </div>
  );
}

export default DeviceList;
