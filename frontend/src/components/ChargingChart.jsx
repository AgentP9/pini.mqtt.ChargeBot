import React, { useMemo } from 'react';
import { calculateProcessEnergyWh } from '../utils/energy.mjs';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import './ChargingChart.css';

// Color palette for multiple processes - distinct colors for better differentiation
const PROCESS_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
const COMPLETION_COLOR = '#f59e0b'; // Yellow color for completion phase
const DEFAULT_SINGLE_COLOR = '#10b981'; // Default green color for single process

function ChargingChart({ processes, patterns = [], completionStatus = null }) {
  // Support both single process (for backward compatibility) and multiple processes
  const processList = Array.isArray(processes) ? processes : [processes].filter(Boolean);
  
  // Helper function to get the device name from pattern matching (similar to ProcessList)
  const getDeviceNameFromPattern = (process) => {
    if (!process.endTime || !patterns || patterns.length === 0) {
      return null; // No pattern for active processes or if no patterns available
    }
    
    // Find pattern that contains this process ID
    const matchingPattern = patterns.find(pattern => 
      pattern.processIds && pattern.processIds.includes(process.id)
    );
    
    if (matchingPattern && matchingPattern.deviceName) {
      return matchingPattern.deviceName;
    }
    
    return null;
  };
  
  const chartData = useMemo(() => {
    if (processList.length === 0) return [];
    
    if (processList.length === 1) {
      // Single process - use timestamp on x-axis
      const process = processList[0];
      if (!process || !process.events) return [];
      
      const powerEvents = process.events
        .filter(e => e.type === 'power_consumption')
        .map(e => ({
          timestamp: new Date(e.timestamp),
          power: e.value,
          time: new Date(e.timestamp).toLocaleTimeString()
        }));
      
      return powerEvents;
    } else {
      // Multiple processes - use time from start (seconds) on x-axis
      const dataPointsMap = new Map(); // Use Map for O(1) lookups
      
      processList.forEach((process, processIndex) => {
        if (!process || !process.events) return;
        
        const powerEvents = process.events.filter(e => e.type === 'power_consumption');
        if (powerEvents.length === 0) return;
        
        const startTime = new Date(process.startTime).getTime();
        
        powerEvents.forEach(e => {
          const eventTime = new Date(e.timestamp).getTime();
          const secondsFromStart = Math.floor((eventTime - startTime) / 1000);
          
          // Skip events that occurred before the process start time (data inconsistencies)
          if (secondsFromStart < 0) return;
          
          // Get or create data point for this second
          let dataPoint = dataPointsMap.get(secondsFromStart);
          if (!dataPoint) {
            const minutes = Math.floor(secondsFromStart / 60);
            const seconds = secondsFromStart % 60;
            dataPoint = { 
              seconds: secondsFromStart, 
              time: `${minutes}m ${seconds}s` 
            };
            dataPointsMap.set(secondsFromStart, dataPoint);
          }
          
          // Add power value for this process
          dataPoint[`process${process.id}`] = e.value;
        });
      });
      
      // Convert Map to array and sort by seconds from start
      return Array.from(dataPointsMap.values()).sort((a, b) => a.seconds - b.seconds);
    }
  }, [processList]);

  const stats = useMemo(() => {
    if (processList.length === 0 || chartData.length === 0) return null;
    
    if (processList.length === 1) {
      const process = processList[0];
      const powers = chartData.map(d => d.power);
      const maxPower = Math.max(...powers);
      const minPower = Math.min(...powers);
      const avgPower = powers.reduce((a, b) => a + b, 0) / powers.length;
      
      // Calculate energy (approximate)
      const duration = process.endTime 
        ? new Date(process.endTime) - new Date(process.startTime)
        : Date.now() - new Date(process.startTime);
      const totalEnergy = calculateProcessEnergyWh(process).toFixed(2); // Integrate timestamped power samples
      
      return {
        maxPower: maxPower.toFixed(2),
        minPower: minPower.toFixed(2),
        avgPower: avgPower.toFixed(2),
        totalEnergy,
        dataPoints: chartData.length
      };
    } else {
      // Multi-process stats - show aggregate stats
      return {
        processCount: processList.length,
        dataPoints: chartData.length
      };
    }
  }, [chartData, processList]);

  if (chartData.length === 0) {
    return (
      <div className="chart-empty">
        <p>No power consumption data available for the selected charging process(es).</p>
      </div>
    );
  }

  const isMultiProcess = processList.length > 1;

  return (
    <div className="charging-chart">
      {!isMultiProcess && (
        <div className="chart-stats">
          <div className="stat-card">
            <div className="stat-label">Max Power</div>
            <div className="stat-value">{stats.maxPower} W</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Avg Power</div>
            <div className="stat-value">{stats.avgPower} W</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Min Power</div>
            <div className="stat-value">{stats.minPower} W</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total Energy</div>
            <div className="stat-value">{stats.totalEnergy} Wh</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Data Points</div>
            <div className="stat-value">{stats.dataPoints}</div>
          </div>
        </div>
      )}
      
      <div className="chart-container" aria-label="Charging power over time">
        <ResponsiveContainer width="100%" height={400}>
          <LineChart
            data={chartData}
            margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.35} />
            <XAxis 
              dataKey={isMultiProcess ? "seconds" : "time"}
              stroke="#666"
              tick={{ fontSize: 12 }}
              minTickGap={28}
              label={isMultiProcess ? { value: 'Time from Start', position: 'insideBottom', offset: -5 } : undefined}
            />
            <YAxis 
              stroke="#666"
              tick={{ fontSize: 12 }}
              label={{ value: 'Power (W)', angle: -90, position: 'insideLeft' }}
            />
            <Tooltip 
              isAnimationActive={false}
              contentStyle={{ 
                backgroundColor: 'white', 
                border: '1px solid #ccc',
                borderRadius: '8px',
                padding: '10px'
              }}
            />
            <Legend />
            {!isMultiProcess ? (
              <Line 
                type="monotone" 
                dataKey="power" 
                stroke={completionStatus?.isInCompletionPhase ? COMPLETION_COLOR : DEFAULT_SINGLE_COLOR} 
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 6 }}
                name="Power (W)"
              />
            ) : (
              processList.map((process, index) => {
                // Get the correct device name from pattern, fallback to process.deviceName
                const deviceName = getDeviceNameFromPattern(process) || process.deviceName;
                
                return (
                  <Line 
                    key={process.id}
                    type="monotone" 
                    dataKey={`process${process.id}`}
                    stroke={PROCESS_COLORS[index % PROCESS_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    name={`Process #${process.id}${deviceName ? ` (${deviceName})` : ''}`}
                    connectNulls={true}
                  />
                );
              })
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default ChargingChart;
