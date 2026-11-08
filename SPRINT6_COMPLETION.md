# Sprint 6 — Intelligent completion detection

The first increment introduces a **read-only** completion assessment that
explains why a charging session is or is not considered complete.

Endpoint: `GET /api/chargers/:chargerId/completion-assessment`.

It returns an `assessment` with `ready`, `reason`, and optional sample
metadata, plus a `comparison` against the existing detector. The Diagnostics
tab shows the evidence and highlights when the detectors disagree. Reasons include `insufficient_samples`,
`insufficient_window_coverage`, `telemetry_stale`, `telemetry_gap`,
`power_above_threshold`, `rising_power_trend`, and `stable_low_power`.

**Safety:** This endpoint is advisory-only. It does not change existing
automatic shutdown decisions. Any future rollout into auto-off requires
fixture parity, negative-case tests, and a separately reviewed opt-in.

Next increments: build realistic replay fixtures, compare the existing detector
against the new assessment, add operator-visible evidence and controlled
rollout criteria.

## Replay safety gate

`tests/test-completion-replay-matrix.js` exercises twelve deterministic
synthetic charging traces, including steady completion, active charging,
transient spikes, negative readings, threshold boundary, telemetry outage,
stale/future data, too few samples, out-of-order data, duplicate timestamps,
and resumed charging. CI requires both detectors to agree on every fixture
and explicitly rejects false positives on known negative traces.

This is a **synthetic parity gate**, not proof of safety on real hardware.
Before enabling the new assessment for automatic shutdown, replay anonymized
production traces and test MQTT disconnects, relay confirmation and delayed
telemetry in an isolated test environment. The production auto-off decision
continues to use the existing detector.
