# Sprint 2 — Completion detection and energy analytics

## Delivered

- Completion detection requires a full low-power observation window,
  sufficiently frequent readings, and a fresh final sample.
- Rising low-power trends, short dips, stale samples and gaps fail closed.
- Versioned deterministic scenarios: `tests/fixtures/completion-scenarios.json`.
  Add a scenario with `name`, `samples` (`[minutesAgo, watts]`),
  `expected` and optional `completed`, `thresholdWatts` and `stableMinutes`.
- Replay runner: `node tests/run-completion-scenarios.js`.
- Energy in Statistics uses time-integrated MQTT power events in Wh rather
  than a non-existent `measurements` property. Integration excludes gaps
  longer than 120 seconds. Missing data therefore *underestimates* energy;
  it does not imply zero real-world consumption.
- GitHub Actions checks the replay corpus, existing backend regression tests,
  energy integration and the production frontend build.

## Acceptance criteria

1. Both backend and frontend GitHub Actions jobs succeed on the PR head.
2. Replay cases include sustained low power, short dips, stale samples,
   missing samples, spikes, increasing power, completed sessions,
   out-of-order events and future timestamps.
3. Energy tests cover constant power, changing power, gaps, invalid samples
   and out-of-order events.
4. Pull request is conflict-free against `main`.

## Operational validation still recommended

Before unattended auto-off, observe real MQTT telemetry from the physical
chargers, including disconnect/reconnect and retained state messages. Compare
the calculated Wh with a known energy meter over several sessions.
Automated tests do not replace hardware validation.

## Follow-up opportunities

Add a larger scenario corpus from anonymized real charge cycles, telemetry
quality indicators and measured-versus-estimated energy confidence.
