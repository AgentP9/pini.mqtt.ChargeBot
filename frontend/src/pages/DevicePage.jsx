import React, { useState, useEffect, useRef } from 'react';
import PatternManager from '../components/PatternManager';
import ProcessList from '../components/ProcessList';
import ProcessFilters from '../components/ProcessFilters';
import ChargingChart from '../components/ChargingChart';
import { formatDateTime } from '../utils/dateFormatter';
import './DevicePage.css';

function DevicePage({ 
  processes, 
  patterns,
  devices,
  onPatternUpdate,
  onDeleteProcess, 
  onCleanupProcesses,
  onCompleteProcess,
  onProcessUpdate
}) {
  const [selectedProcesses, setSelectedProcesses] = useState([]);
  const [selectedPatternId, setSelectedPatternId] = useState(null);
  const [cleanupDays, setCleanupDays] = useState(90);
  const [cleanupMessage, setCleanupMessage] = useState('');
  const [filters, setFilters] = useState({
    state: 'all',
    charger: 'all',
    device: 'all',
    startDate: '',
    endDate: ''
  });
  
  // Use ref to track the currently selected process IDs
  const selectedProcessIdsRef = useRef([]);

  // Update ref when selectedProcesses changes
  useEffect(() => {
    selectedProcessIdsRef.current = selectedProcesses.map(p => p.id);
  }, [selectedProcesses]);

  // Update selected processes with fresh data if any are selected
  useEffect(() => {
    if (selectedProcessIdsRef.current.length > 0) {
      const updatedProcesses = processes.filter(p => 
        selectedProcessIdsRef.current.includes(p.id)
      );
      setSelectedProcesses(updatedProcesses);
    }
  }, [processes]);

  // Sync device filter when selected pattern's device name changes
  useEffect(() => {
    if (selectedPatternId) {
      const selectedPattern = patterns.find(p => p.id === selectedPatternId);
      if (selectedPattern) {
        // Check if the pattern has a valid deviceName
        if (selectedPattern.deviceName) {
          setFilters(prevFilters => {
            if (prevFilters.device !== selectedPattern.deviceName) {
              return {
                ...prevFilters,
                device: selectedPattern.deviceName
              };
            }
            return prevFilters;
          });
        }
        // If pattern exists but has no deviceName (shouldn't happen, but defensive coding)
        // Don't change filters - keep current state
      } else {
        // Pattern no longer exists - clear selection
        setSelectedPatternId(null);
        setFilters(prevFilters => ({
          ...prevFilters,
          device: 'all'
        }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patterns, selectedPatternId]);

  const handleProcessSelect = (process) => {
    setSelectedProcesses(prevSelected => {
      const isAlreadySelected = prevSelected.some(p => p.id === process.id);
      
      if (isAlreadySelected) {
        return prevSelected.filter(p => p.id !== process.id);
      } else {
        return [...prevSelected, process];
      }
    });
  };

  const handleClearSelection = () => {
    setSelectedProcesses([]);
  };

  const handleToggleSelectAll = (filteredProcesses) => {
    const allSelected = filteredProcesses.every(process => 
      selectedProcesses.some(sp => sp.id === process.id)
    );
    
    if (allSelected) {
      const filteredIds = new Set(filteredProcesses.map(p => p.id));
      setSelectedProcesses(prevSelected => 
        prevSelected.filter(p => !filteredIds.has(p.id))
      );
    } else {
      const selectedIds = new Set(selectedProcesses.map(p => p.id));
      const newSelections = filteredProcesses.filter(p => !selectedIds.has(p.id));
      setSelectedProcesses(prevSelected => [...prevSelected, ...newSelections]);
    }
  };

  const handleFilterChange = (newFilters) => {
    setFilters(newFilters);
    if (newFilters.device !== filters.device) {
      const selectedPattern = patterns.find(p => p.id === selectedPatternId);
      const selectedPatternDeviceName = selectedPattern?.deviceName;
      if (newFilters.device !== selectedPatternDeviceName) {
        setSelectedPatternId(null);
      }
    }
  };

  const handlePatternSelect = (patternId) => {
    setSelectedPatternId(patternId);
    
    let deviceFilterValue = 'all';
    if (patternId) {
      const pattern = patterns.find(p => p.id === patternId);
      // Ensure pattern exists and has a valid deviceName before using it
      if (pattern && pattern.deviceName && pattern.deviceName.trim() !== '') {
        deviceFilterValue = pattern.deviceName;
      }
    }
    
    setFilters({
      ...filters,
      device: deviceFilterValue,
      charger: 'all'
    });
  };

  // Wrapper for onPatternUpdate that clears selections before the update
  const handlePatternUpdate = async (action, data) => {
    // Clear all selections before executing pattern update operations
    // This prevents issues with stale data when patterns are renamed/merged/deleted
    // Note: React batches these state updates together in the same render cycle.
    // By the time the backend operation completes and fetchData() returns fresh data,
    // these selections will definitely be cleared.
    setSelectedProcesses([]);
    setSelectedPatternId(null);
    
    // Execute the pattern update (which includes fetchData() call)
    return onPatternUpdate(action, data);
  };

  // Wrapper for onProcessUpdate that clears selections before the update
  const handleProcessUpdate = async (action, data) => {
    // Clear all selections before executing process update operations
    // This prevents issues with stale data when processes are renamed
    // (which can affect patterns and other processes)
    // Note: React batches these state updates together in the same render cycle.
    // By the time the backend operation completes and fetchData() returns fresh data,
    // these selections will definitely be cleared.
    setSelectedProcesses([]);
    setSelectedPatternId(null);
    
    // Execute the process update (which includes fetchData() call)
    return onProcessUpdate(action, data);
  };

  const handleCleanupProcesses = async () => {
    if (!Number.isInteger(cleanupDays) || cleanupDays < 1 || cleanupDays > 36500) {
      return;
    }

    if (!window.confirm(`Delete completed charging processes older than ${cleanupDays} days? Active processes and device recognition patterns will be kept.`)) {
      return;
    }

    try {
      const deletedCount = await onCleanupProcesses(cleanupDays);
      setSelectedProcesses([]);
      setCleanupMessage(`Deleted ${deletedCount} old completed process${deletedCount === 1 ? '' : 'es'}.`);
    } catch (error) {
      console.error('Error cleaning up charging processes:', error);
      setCleanupMessage('Failed to clean up charging processes. Please try again.');
    }
  };

  return (
    <div className="device-page">
      <div className="dashboard-grid">
        <section className="card patterns-section">
          <h2>Recognized Devices</h2>
          <PatternManager 
            patterns={patterns}
            selectedPatternId={selectedPatternId}
            onPatternUpdate={handlePatternUpdate}
            onSelectPattern={handlePatternSelect}
          />
        </section>

        <section className="card processes-section">
          <div className="process-section-header">
            <h2>Device Charging Processes</h2>
            <div className="process-cleanup-controls">
              <label htmlFor="cleanup-days">Delete completed processes older than</label>
              <input
                id="cleanup-days"
                type="number"
                min="1"
                max="36500"
                value={cleanupDays}
                onChange={event => {
                  setCleanupDays(Number(event.target.value));
                  setCleanupMessage('');
                }}
              />
              <span>days</span>
              <button
                type="button"
                onClick={handleCleanupProcesses}
                disabled={!Number.isInteger(cleanupDays) || cleanupDays < 1 || cleanupDays > 36500}
              >
                Cleanup
              </button>
            </div>
          </div>
          {cleanupMessage && <p className="process-cleanup-message" role="status">{cleanupMessage}</p>}
          <div className="filters-and-select-container">
            <ProcessFilters 
              filters={filters}
              onFilterChange={handleFilterChange}
              devices={devices}
              patterns={patterns}
            />
            {(() => {
              const filterStartDate = filters?.startDate ? (() => {
                const date = new Date(filters.startDate);
                date.setHours(0, 0, 0, 0);
                return date;
              })() : null;
              
              const filterEndDate = filters?.endDate ? (() => {
                const date = new Date(filters.endDate);
                date.setHours(23, 59, 59, 999);
                return date;
              })() : null;
              
              const processIdToDeviceName = {};
              if (patterns && patterns.length > 0) {
                patterns.forEach(pattern => {
                  if (pattern.processIds && pattern.deviceName) {
                    pattern.processIds.forEach(processId => {
                      processIdToDeviceName[processId] = pattern.deviceName;
                    });
                  }
                });
              }
              
              const filteredProcesses = processes.filter(process => {
                const isCompleted = process.endTime !== null && process.endTime !== undefined;
                if (filters?.state === 'active' && isCompleted) return false;
                if (filters?.state === 'completed' && !isCompleted) return false;
                
                if (filters?.charger && filters.charger !== 'all') {
                  const processChargerId = process.chargerId || process.deviceId;
                  if (processChargerId !== filters.charger) return false;
                }
                
                if (filters?.device && filters.device !== 'all') {
                  const deviceName = processIdToDeviceName[process.id];
                  if (!deviceName || deviceName !== filters.device) return false;
                }
                
                if (filterStartDate) {
                  const processDate = new Date(process.startTime);
                  if (processDate < filterStartDate) return false;
                }
                
                if (filterEndDate) {
                  const processDate = new Date(process.startTime);
                  if (processDate > filterEndDate) return false;
                }
                
                return true;
              });
              
              const allFilteredSelected = filteredProcesses.length > 0 && filteredProcesses.every(process => 
                selectedProcesses.some(sp => sp.id === process.id)
              );
              
              return filteredProcesses.length > 0 && (
                <button
                  className="select-all-toggle-button"
                  onClick={() => handleToggleSelectAll(filteredProcesses)}
                  title={allFilteredSelected ? "Deselect all filtered processes" : "Select all filtered processes"}
                  aria-label={allFilteredSelected ? "Deselect all filtered processes" : "Select all filtered processes"}
                >
                  {allFilteredSelected ? '☑' : '☐'}
                </button>
              );
            })()}
          </div>
          <ProcessList 
            processes={processes}
            patterns={patterns}
            selectedProcesses={selectedProcesses}
            onSelectProcess={handleProcessSelect}
            onDeleteProcess={onDeleteProcess}
            onCompleteProcess={onCompleteProcess}
            onPatternUpdate={handlePatternUpdate}
            onProcessUpdate={handleProcessUpdate}
            filters={filters}
          />
        </section>
      </div>

      {selectedProcesses.length > 0 && (
        <section className="card chart-section">
          <div className="chart-header">
            <h2>
              {selectedProcesses.length === 1 
                ? `Charging Details - Process #${selectedProcesses[0].id}`
                : `Comparing ${selectedProcesses.length} Charging Processes`
              }
            </h2>
            <button 
              className="clear-selection-button"
              onClick={handleClearSelection}
              title="Clear selection"
            >
              Clear Selection
            </button>
          </div>
          {selectedProcesses.length === 1 && (
            <div className="process-info">
              <div className="info-item">
                <strong>Device:</strong> {selectedProcesses[0].deviceName || selectedProcesses[0].deviceId}
              </div>
              <div className="info-item">
                <strong>Start:</strong> {formatDateTime(selectedProcesses[0].startTime)}
              </div>
              {selectedProcesses[0].endTime && (
                <div className="info-item">
                  <strong>End:</strong> {formatDateTime(selectedProcesses[0].endTime)}
                </div>
              )}
              <div className="info-item">
                <strong>Status:</strong> 
                <span className={selectedProcesses[0].endTime ? 'status-completed' : 'status-active'}>
                  {selectedProcesses[0].endTime ? ' Completed' : ' Active'}
                </span>
              </div>
            </div>
          )}
          <ChargingChart processes={selectedProcesses} patterns={patterns} />
        </section>
      )}
    </div>
  );
}

export default DevicePage;
