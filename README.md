# piniChargingBot

A Docker-based application for monitoring device charging via MQTT-compatible power plugs (e.g., Shelly Plug S).

## Overview

This application tracks charging sessions for your devices (iPhones, TonieBoxes, etc.) through physical chargers (ShellyPlugs). It uses pattern recognition to automatically identify which device is being charged based on power consumption characteristics.

**Key Concepts:**
- **Charger**: Physical charging device like a ShellyPlug that connects to power
- **Device**: The item being charged (iPhone, TonieBox, etc.)
- **Charging Process**: A session when a device is connected to a charger and is being charged

## Features

- **Real-time MQTT Monitoring**: Connects to MQTT broker and subscribes to configurable charger topics
- **Charging Process Tracking**: Automatically tracks charging sessions based on power on/off events
- **Power Consumption Logging**: Records power consumption data with timestamps
- **AI-Powered Pattern Recognition**: Automatically identifies charged devices based on power consumption characteristics
- **Device Label Management**: Edit, merge, and manage device labels for recognized charging patterns
- **Appliance Monitoring**: Detects wash/dishwasher cycle start and end via power threshold — fires an MQTT notification when a cycle completes (no auto-off)
- **Modern Responsive UI**: Web interface with real-time updates and interactive charts
- **Dark Mode / Light Mode**: Toggle between dark and light themes with persistent preference
- **Multi-Charger Support**: Monitor multiple chargers simultaneously
- **Progressive Web App (PWA)**: Add to your iPhone/Android home screen for a native app experience
- **Persistent Data Storage**: File-based storage that survives container restarts and updates
- **Docker Deployment**: Easy deployment with Docker Compose or Portainer

## Architecture

The application consists of two main components:

1. **Backend (Node.js + Express)**: 
   - MQTT client that subscribes to device topics
   - REST API for frontend communication
   - File-based persistent storage of charging processes and patterns
   - AI-powered pattern recognition engine

2. **Frontend (React + Recharts)**:
   - Modern, responsive web interface with dark/light mode
   - Real-time device status display
   - Interactive power consumption charts
   - Charging process selection and visualization
   - Device label management interface

For detailed technical architecture, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Prerequisites

- Docker and Docker Compose installed (or Portainer for web-based management)
- MQTT-compatible power plugs (e.g., Shelly Plug S) configured to publish to MQTT - these are your **chargers**
- An MQTT broker (e.g., Mosquitto, HiveMQ, or any MQTT-compatible broker)

## Quick Start

### Option 1: Docker Compose (Command Line)

1. Clone the repository:
   ```bash
   git clone https://github.com/AgentP9/piniChargingBot.git
   cd piniChargingBot
   ```

2. Configure environment variables:
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and configure your MQTT broker and chargers:
   ```env
   # Use your MQTT broker
   MQTT_BROKER_URL=mqtt://192.168.1.100:1883
   MQTT_USERNAME=your-username  # if required
   MQTT_PASSWORD=your-password  # if required
   MQTT_DEVICES=Office Charger:shellies/shellyplug07,Kitchen Charger:shellies/shellyplug02
   ```

3. Start the application:
   ```bash
   docker-compose up -d
   ```

4. Access the web interface:
   - Frontend: http://localhost:1818
   - Backend API: Available only through frontend proxy at http://localhost:1818/api/health

### Option 2: Portainer (Web-based Management)

For users who prefer a graphical interface, Portainer provides an easy way to deploy and configure the application through a web UI:

1. Access your Portainer instance
2. Go to **Stacks** → **+ Add stack**
3. Select **Repository** as the build method
4. Enter repository URL: `https://github.com/AgentP9/piniChargingBot`
5. Configure environment variables through the web interface
6. Deploy the stack

See the [Portainer Deployment Guide](#portainer-deployment-guide) section below for detailed instructions.

## Progressive Web App (PWA) Support

The application can be installed on mobile devices for a native app experience:

### Installation:

**iOS (iPhone/iPad):**
1. Open the app in Safari (http://your-server:1818)
2. Tap the Share button (square with arrow pointing up)
3. Scroll down and tap "Add to Home Screen"
4. Tap "Add" in the top right corner
5. The app will open in standalone mode without Safari UI

**Android:**
1. Open the app in Chrome (http://your-server:1818)
2. Tap the menu button (⋮) in the top right
3. Tap "Add to Home Screen" or "Install app"
4. The app will open in standalone mode

## Configuration

### Environment Variables

All configuration can be managed via environment variables (through `.env` file or Portainer):

- `MQTT_BROKER_URL`: MQTT broker URL (e.g., `mqtt://your-broker:1883`)
- `MQTT_USERNAME`: MQTT username (optional)
- `MQTT_PASSWORD`: MQTT password (optional)
- `MQTT_DEVICES`: Charger configurations in the format `Name:topic` or legacy format `chargerId`
  - New format: `Office Charger:shellies/shellyplug07,Kitchen:shellies/shellyplug02`
  - Legacy format (backward compatible): `shellyplug-s-12345,shellyplug-s-67890`
- `MQTT_APPLIANCES`: Appliance configurations for devices like washing machines (optional)
  - Format: `Name:topic` or `Name:topic:notifyTopic`
  - Example: `Washing Machine:shellies/washer,Dishwasher:shellies/dish:home/alerts/done`

### MQTT Topics

For each charger configuration, the backend subscribes to:
- `{topic}/relay/0` - Power on/off events
- `{topic}/relay/0/power` - Power consumption in Watts

Example for charger configured as "Office Charger:shellies/shellyplug07":
- Subscribes to: `shellies/shellyplug07/relay/0` - Receives "on" or "off"
- Subscribes to: `shellies/shellyplug07/relay/0/power` - Receives power value (e.g., "15.5")
- Displays as: "Office Charger" in the UI

## Appliance Monitoring

The application supports monitoring appliances like washing machines or dishwashers. Unlike chargers, appliances are **never switched off** — instead, the system detects when a cycle starts and ends based on power consumption changes, then fires an MQTT notification.

### How Appliance Monitoring Works

1. **Cycle Start**: When the appliance's power consumption rises to or above **10 W**, a cycle is recorded as started.
2. **Cycle End Detection**: When power drops below **10 W** and stays there for **5 minutes**, the cycle is confirmed as ended.
3. **MQTT Notification**: On cycle end, a JSON message is published to the configured notification topic.

### Notification Payload

```json
{
  "event": "cycle_complete",
  "applianceName": "Washing Machine",
  "applianceId": "shellies_washer",
  "processId": 42,
  "startTime": "2024-01-01T08:00:00.000Z",
  "endTime": "2024-01-01T09:30:00.000Z",
  "durationMinutes": 90.0
}
```

### Configuring Appliances

Add appliances to your `.env` file using `MQTT_APPLIANCES`:

```env
# Single washing machine (notify topic defaults to shellies/washer/notify)
MQTT_APPLIANCES=Washing Machine:shellies/washer

# Multiple appliances with custom notify topics
MQTT_APPLIANCES=Washing Machine:shellies/washer:home/laundry/done,Dishwasher:shellies/dish:home/kitchen/done
```

The backend subscribes to `{topic}/relay/0/power` for each appliance.

### Appliance API Endpoints

- `GET /api/appliances` - List all configured appliances and their current state
- `GET /api/appliances/:id` - Get state of a specific appliance
- `GET /api/appliances/:id/active-process` - Get the currently running cycle
- `GET /api/appliances/:id/processes` - Get all recorded cycles for an appliance

## Pattern Recognition

The system automatically analyzes completed charging processes to identify patterns and group similar charging sessions. This enables automatic device recognition based on power consumption characteristics.

### How It Works

**Device Fingerprinting** based on:
1. **Power Consumption Statistics**: Average, median, min, max power, standard deviation
2. **Charging Curve Shape**: Early/middle/late phase power consumption
3. **Peak Power Behavior**: Ratio of time spent at high power

**Pattern Matching**: Charging sessions with similar power profiles (similarity score > 65%) are automatically grouped into patterns representing unique devices.

### Managing Device Labels

You can customize device names through the Pattern Manager interface:
- **Edit Labels**: Rename recognized patterns from auto-generated names (Hugo, Egon) to meaningful names (Alice's iPhone)
- **Merge Patterns**: Combine two patterns by renaming one to match another
- **Split Patterns**: Rename individual charging sessions to create new patterns
- **Delete Patterns**: Remove patterns that are no longer needed

### Troubleshooting Pattern Recognition

**Not seeing device names?** Ensure:
1. Processes are **completed** (have an endTime)
2. Processes have at least **3 power consumption events**
3. Pattern analysis has run (automatic on startup, or manual via API)

Check the diagnostic endpoint: `http://localhost:1818/api/patterns/debug`

For more details, see the [Troubleshooting](#troubleshooting) section below.

## Data Storage and Persistence

The application uses file-based persistent storage that **survives container restarts and updates**:

- **Storage Location**: `/app/data` in the container (mapped to `backend-data` Docker volume)
- **Files Stored**:
  - `charging-processes.json` - All charging session data
  - `charging-patterns.json` - Recognized device patterns
  - `process-counter.json` - Process ID counter

### Safe Update Procedure

When updating to the latest version:

```bash
# Pull latest code
git pull origin main

# Rebuild and restart (preserves backend-data volume)
docker-compose up -d --build

# Verify data was loaded
docker-compose logs backend | grep "Loaded.*processes"
```

**Important:** Do NOT use `docker-compose down -v` as this removes volumes and deletes all data!

### Backup Your Data

```bash
# Find your volume name
VOLUME_NAME=$(docker volume ls | grep backend-data | awk '{print $2}')

# Create backup
docker run --rm -v $VOLUME_NAME:/data -v $(pwd)/backups:/backup \
  alpine tar czf /backup/data-$(date +%Y%m%d).tar.gz -C /data .
```

### Restore Data from Backup

```bash
# Stop the backend
docker-compose stop backend

# Restore data
docker run --rm -v $VOLUME_NAME:/data -v $(pwd)/backups:/backup \
  alpine tar xzf /backup/data-YYYYMMDD.tar.gz -C /data

# Start the backend
docker-compose start backend
```

## API Endpoints

### Charger & Process Management

- `GET /api/health` - Health check and MQTT connection status
- `GET /api/chargers` - Get all charger states
- `GET /api/chargers/:chargerId` - Get specific charger state
- `GET /api/chargers/:chargerId/active-processes` - Get active (incomplete) processes for a charger
- `GET /api/processes` - Get all charging processes
- `GET /api/processes/:id` - Get specific charging process
- `GET /api/processes/:id/guess` - Get educated guess for an active process (non-persistent)
- `GET /api/processes/charger/:chargerId` - Get processes for a charger
- `PUT /api/processes/:id/complete` - Manually mark a process as complete
- `PUT /api/processes/:id/device-name` - Rename individual process (splits pattern)
- `DELETE /api/processes/:id` - Delete a specific charging process

### Pattern Recognition

- `GET /api/patterns` - Get all identified charging patterns (device fingerprints)
- `GET /api/patterns/charger/:chargerId` - Get patterns for a specific charger
- `POST /api/patterns/analyze` - Manually trigger pattern analysis
- `POST /api/patterns/rerun` - Clear and recreate all patterns from scratch
- `GET /api/processes/:id/pattern` - Get matching pattern for a charging process
- `GET /api/patterns/debug` - Diagnostic endpoint for troubleshooting pattern issues
- `PUT /api/patterns/:patternId/label` - Update device label for a pattern
- `POST /api/patterns/merge` - Merge two patterns into one
- `DELETE /api/patterns/:patternId` - Delete a pattern

## Portainer Deployment Guide

For users who prefer a graphical interface to manage Docker containers:

### Deploy from Git Repository

1. **Access Portainer** (e.g., `http://localhost:9000`)
2. **Create New Stack**: Go to **Stacks** → **+ Add stack**
3. **Configure Repository**:
   - Stack name: `pini-charging-monitor`
   - Build method: **Repository**
   - Repository URL: `https://github.com/AgentP9/piniChargingBot`
   - Branch: `main`
   - Compose path: `docker-compose.yml`

4. **Configure Environment Variables**:

   | Variable | Description | Example |
   |----------|-------------|---------|
   | `MQTT_BROKER_URL` | MQTT broker URL | `mqtt://192.168.1.100:1883` |
   | `MQTT_USERNAME` | MQTT username (optional) | `myuser` |
   | `MQTT_PASSWORD` | MQTT password (optional) | `mypassword` |
   | `MQTT_DEVICES` | Charger configurations | `Office:shellies/plug07,Kitchen:shellies/plug02` |

5. **Deploy**: Click **Deploy the stack**

### Managing Configuration

To update environment variables in Portainer:
1. Navigate to **Stacks** → `pini-charging-monitor`
2. Click **Editor** tab
3. Modify environment variables
4. Click **Update the stack**

### Viewing Logs

1. Navigate to **Containers**
2. Click on container name (e.g., `pini-backend`)
3. Click **Logs** to view real-time logs

## Development

### Backend Development

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your MQTT broker configuration
npm run dev
```

### Frontend Development

```bash
cd frontend
npm install
npm run dev
```

The frontend will be available at http://localhost:5173 with hot reload enabled.

## Troubleshooting

### Backend can't connect to MQTT broker
- Verify the `MQTT_BROKER_URL` in your `.env` file
- Ensure your MQTT broker is running and accessible
- Check firewall settings if using external broker
- View logs: `docker-compose logs backend`

### No data showing in frontend
- Verify backend is running: `docker-compose logs backend`
- Check backend health: http://localhost:1818/api/health
- Ensure chargers (physical devices) are publishing to the correct MQTT topics
- Check that MQTT messages are being received (check backend logs)

### Pattern Recognition Not Working

**Check the diagnostic endpoint**: http://localhost:1818/api/patterns/debug

This shows:
- Total number of processes
- How many are completed
- Which processes have power consumption data
- Pattern assignments

**Common issues**:

1. **"Insufficient power data"** - Charging session was too short
   - Solution: Ensure MQTT power plug publishes power readings regularly
   - Processes need at least 3 power consumption events

2. **No patterns found** - Not enough completed processes
   - Solution: Complete at least 2-3 charging sessions per device
   - Manually trigger analysis: `curl -X POST http://localhost:1818/api/patterns/analyze`

3. **Patterns exist but device names not showing**
   - Check browser console for errors
   - Verify `/api/patterns` returns patterns with your process IDs
   - Ensure processes are completed (not active)

### Frontend can't connect to backend
- Check containers are running: `docker-compose ps`
- Check backend health: http://localhost:1818/api/health
- Check browser console for errors
- Verify both containers are on the same Docker network

### Data disappeared after update
- Check if you ran `docker-compose down -v` (removes volumes)
- Verify volume still exists: `docker volume ls | grep backend-data`
- Restore from backup (see Data Storage section)

## Theme Support

The application includes dark and light mode themes:

- **Theme Toggle**: Click the moon/sun icon in the top-right corner
- **Persistent Preference**: Theme selection is saved to browser's localStorage
- **Smooth Transitions**: Theme changes animate smoothly
- **Full Coverage**: All components support both themes

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.
