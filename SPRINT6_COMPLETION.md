# Sprint 6 — Intelligent completion detection

The first increment introduces a **read-only** completion assessment that
explains why a charging session is or is not considered complete.

Endpoint: `GET /api/chargers/:chargerId/completion-assessment`.

It returns an `assessment` with `ready`, `reason`, and optional sample
metadata. Reasons include `insufficient_samples`,
`insufficient_window_coverage`, `telemetry_stale`, `telemetry_gap`,
`power_above_threshold`, `rising_power_trend`, and `stable_low_power`.

**Safety:** This endpoint is advisory-only. It does not change existing
automatic shutdown decisions. Any future rollout into auto-off requires
fixture parity, negative-case tests, and a separately reviewed opt-in.

Next increments: build realistic replay fixtures, compare the existing detector
against the new assessment, add operator-visible evidence and controlled
rollout criteria.
