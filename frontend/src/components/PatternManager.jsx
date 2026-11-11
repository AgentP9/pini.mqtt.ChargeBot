import React, { useState, useEffect } from 'react';
import DeviceLabelModal from './DeviceLabelModal';
import './PatternManager.css';

function PatternManager({ patterns, selectedPatternId, onPatternUpdate, onSelectPattern }) {
  const [expandedPattern, setExpandedPattern] = useState(null);
  const [editingPattern, setEditingPattern] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Update editingPattern reference when patterns array changes
  // This ensures we're always working with the current pattern object
  useEffect(() => {
    if (editingPattern) {
      const currentPattern = patterns.find(p => p.id === editingPattern.id);
      if (currentPattern) {
        // Update to the current pattern object from the new patterns array
        setEditingPattern(currentPattern);
      } else {
        // Pattern no longer exists, close the modal
        setEditingPattern(null);
      }
    }
  }, [patterns]); // Only depend on patterns, not editingPattern, to avoid infinite loop

  const handleDeletePattern = async (patternId, deviceName) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete the pattern for device "${deviceName}"?\n\n` +
      `This will remove the pattern, but charging processes will not be deleted.`
    );

    if (confirmed) {
      try {
        await onPatternUpdate('delete', { patternId });
      } catch (error) {
        console.error('Error deleting pattern:', error);
        alert('Failed to delete pattern. Please try again.');
      }
    }
  };

  const handleRerunRecognition = async () => {
    const confirmed = window.confirm(
      `Are you sure you want to rerun device recognition?\n\n` +
      `This will clear all existing patterns and reanalyze all charging processes from scratch.\n` +
      `Only patterns that have been manually renamed will be preserved.`
    );

    if (confirmed) {
      try {
        await onPatternUpdate('rerun', {});
      } catch (error) {
        console.error('Error rerunning recognition:', error);
        alert('Failed to rerun device recognition. Please try again.');
      }
    }
  };

  const handleEditPattern = (e, pattern) => {
    e.stopPropagation(); // Prevent card selection when clicking edit
    setEditingPattern(pattern);
  };

  const handleSaveLabel = async (patternId, newLabel, shouldRenameAll) => {
    try {
      await onPatternUpdate('updateLabel', { patternId, newLabel, shouldRenameAll });
      setEditingPattern(null);
    } catch (error) {
      console.error('Error updating label:', error);
      alert('Failed to update device label. Please try again.');
    }
  };

  const handleMergePatterns = async (sourcePatternId, targetPatternId) => {
    try {
      await onPatternUpdate('merge', { sourcePatternId, targetPatternId });
      setEditingPattern(null);
    } catch (error) {
      console.error('Error merging patterns:', error);
      alert('Failed to merge patterns. Please try again.');
    }
  };

  const handleCloseModal = () => {
    setEditingPattern(null);
  };

  const handleCreatePattern = async (deviceName) => {
    try {
      await onPatternUpdate('create', { deviceName });
      setShowCreateModal(false);
    } catch (error) {
      console.error('Error creating pattern:', error);
      if (error.message.includes('already exists')) {
        alert('A pattern with this device name already exists. Please choose a different name.');
      } else {
        alert('Failed to create pattern. Please try again.');
      }
    }
  };

  if (!patterns || patterns.length === 0) {
    return (
      <div className="pattern-manager">
        <div className="pattern-header-row">
          <button 
            className="rerun-button"
            onClick={handleRerunRecognition}
            title="Rerun device recognition from scratch"
          >
            🔄 Rerun Recognition
          </button>
        </div>
        <p className="empty-message">No device patterns have been identified yet. Complete some charging sessions to start recognizing devices.</p>
      </div>
    );
  }

  // Display name from pattern.deviceName instead of mapping
  const getDisplayName = (pattern) => pattern.deviceName;

  const handlePatternClick = (patternId) => {
    // If clicking the already selected pattern, deselect it
    if (selectedPatternId === patternId) {
      onSelectPattern(null);
    } else {
      onSelectPattern(patternId);
    }
  };

  return (
    <div className="pattern-manager">
      <div className="pattern-header-row">
        <div className="header-buttons">
          <button 
            className="create-button"
            onClick={() => setShowCreateModal(true)}
            title="Create a new device pattern manually"
          >
            ✨ New Pattern
          </button>
          <button 
            className="rerun-button"
            onClick={handleRerunRecognition}
            title="Rerun device recognition from scratch"
          >
            🔍 Rerun Recognition
          </button>
        </div>
      </div>
      <div className="pattern-list">
        {patterns.map((pattern, index) => {
          const displayName = getDisplayName(pattern);
          const isExpanded = expandedPattern === pattern.id;
          const isSelected = selectedPatternId === pattern.id;

          return (
            <div 
              key={pattern.id} 
              className={`pattern-card ${isSelected ? 'selected' : ''}`}
              onClick={() => handlePatternClick(pattern.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handlePatternClick(pattern.id);
                }
              }}
              aria-pressed={isSelected}
              aria-label={`Select ${pattern.deviceName || displayName}`}
            >
              <div className="pattern-header">
                <div className="pattern-info">
                  <span className="pattern-name">{pattern.deviceName || displayName}</span>
                  <span className="pattern-count">{pattern.count} sessions</span>
                </div>
                <div className="pattern-actions">
                  <button
                    className="pattern-expand-btn"
                    aria-label={isExpanded ? `Collapse ${displayName} details` : `Expand ${displayName} details`}
                    aria-expanded={isExpanded}
                    onClick={(e) => {
                      e.stopPropagation(); // Prevent card selection when clicking expand
                      setExpandedPattern(isExpanded ? null : pattern.id);
                    }}
                    title={isExpanded ? "Collapse" : "Expand"}
                  >
                    {isExpanded ? '−' : '+'}
                  </button>
                  <button
                    className="pattern-edit-btn"
                    aria-label={`Edit ${displayName} device name`}
                    onClick={(e) => handleEditPattern(e, pattern)}
                    title="Edit device name"
                  >
                    ✏️
                  </button>
                  <button
                    className="pattern-delete-btn"
                    aria-label={`Delete ${displayName} recognition pattern`}
                    onClick={(e) => {
                      e.stopPropagation(); // Prevent card selection when clicking delete
                      handleDeletePattern(pattern.id, pattern.deviceName || displayName);
                    }}
                    title="Delete this pattern"
                  >
                    🗑️
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="pattern-details">
                  <div className="detail-grid">
                    <div className="detail-item">
                      <span className="detail-label">Average Power:</span>
                      <span className="detail-value">{pattern.averageProfile?.mean?.toFixed(1) ?? 'N/A'} W</span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">Average Duration:</span>
                      <span className="detail-value">{pattern.statistics?.averageDuration?.toFixed(1) ?? 'N/A'} min</span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">Total Sessions:</span>
                      <span className="detail-value">{pattern.statistics?.totalSessions ?? 'N/A'}</span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">Last Seen:</span>
                      <span className="detail-value">{pattern.lastSeen ? new Date(pattern.lastSeen).toLocaleDateString() : 'N/A'}</span>
                    </div>
                  </div>

                  <div className="charging-profile">
                    <h4>Charging Profile</h4>
                    <div className="profile-curve">
                      <div className="curve-phase">
                        <span className="phase-label">Early</span>
                        <span className="phase-value">{pattern.averageProfile?.curveShape?.early?.toFixed(1) ?? 'N/A'} W</span>
                      </div>
                      <div className="curve-phase">
                        <span className="phase-label">Middle</span>
                        <span className="phase-value">{pattern.averageProfile?.curveShape?.middle?.toFixed(1) ?? 'N/A'} W</span>
                      </div>
                      <div className="curve-phase">
                        <span className="phase-label">Late</span>
                        <span className="phase-value">{pattern.averageProfile?.curveShape?.late?.toFixed(1) ?? 'N/A'} W</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editingPattern && (
        <DeviceLabelModal
          pattern={editingPattern}
          patterns={patterns}
          onClose={handleCloseModal}
          onSave={handleSaveLabel}
          onMerge={handleMergePatterns}
        />
      )}

      {showCreateModal && (
        <CreatePatternModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreatePattern}
        />
      )}
    </div>
  );
}

// Simple modal component for creating new patterns
function CreatePatternModal({ onClose, onCreate }) {
  const [deviceName, setDeviceName] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!deviceName.trim()) {
      setError('Please enter a device name');
      return;
    }
    onCreate(deviceName.trim());
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Create New Pattern</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="error-message">{error}</div>}
            <div className="form-group">
              <label htmlFor="new-pattern-name">Device Name:</label>
              <input
                id="new-pattern-name"
                type="text"
                value={deviceName}
                onChange={(e) => {
                  setDeviceName(e.target.value);
                  setError('');
                }}
                placeholder="Enter device name (e.g., Laptop, iPhone)"
                autoComplete="off"
                autoFocus
                className="label-input"
              />
              <small className="help-text">
                Create a new pattern that processes can be assigned to.
              </small>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Create Pattern
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default PatternManager;
