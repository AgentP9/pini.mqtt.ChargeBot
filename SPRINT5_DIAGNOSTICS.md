# Sprint 5 — Observability and diagnostics

## Frontend

Open **Diagnostics** in the main navigation. The page refreshes every five
seconds and displays MQTT connectivity, uptime, charger relay confirmation,
auto-off eligibility reasons, appliance telemetry state, backup inventory,
and a filterable timeline of recent events.

## API

- `GET /api/diagnostics/status`: live runtime state, auto-off eligibility
  reason per charger, and validated backup inventory (no absolute file paths).
- `GET /api/diagnostics/events?limit=50&type=mqtt_connected&sinceId=1`:
  bounded runtime journal. `limit` is clamped to journal capacity.

Reasons include `disabled`, `mqtt_disconnected`, `relay_off`,
`relay_unconfirmed`, `no_active_process`, `telemetry_stale`,
`completion_timer_active`, and `monitoring`.

## Auto-off decision tracing

The journal records deduplicated `auto_off_state_changed` transitions (e.g.
`monitoring`, `completion_detected`, `telemetry_stale`, or
`mqtt_disconnected`). After the completion delay, an
`auto_off_revalidated` event records whether shutdown is allowed and the
reason. A command event is recorded only when shutdown is requested. The
revalidation decision also requires confirmed relay state and a matching
active session. CI covers disconnect, stale/future telemetry, changed session,
relay confirmation, disabled automation, and resumed charging.

## Operational limits

- The event journal is **in-memory** and intentionally resets on backend
  restart. It is not an audit log or a replacement for centralized logging.
- Event details avoid raw MQTT payloads and credentials, but device names and
  IDs are visible. Protect the API behind the same network/authentication
  controls as other ChargeBot endpoints.
- Auto-off eligibility is a snapshot, not a command or a guarantee that an
  automatic shutdown will occur.
- Backup health checks read backup files on each diagnostics request. Keep
  history sizes and dashboard polling frequency in mind.
- Hardware and real broker fault-injection tests remain outstanding.
