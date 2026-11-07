# Sprint 3 — MQTT recovery and operational checks

## Implemented

- On backend startup, recover the latest persisted open charging session for each charger.
- On MQTT reconnect, retain the session ID instead of resetting it.
- The first relay ON resumes an open session; the first OFF closes it.
- Require a freshly confirmed relay state before recording charger power or evaluating auto-off.
- Recover appliance cycles from persisted history after backend restart and broker reconnect; cancel old end timers and wait for fresh power readings.
- Regression tests for recovery, reconnect, duplicate relay ON, stale runtime IDs and closed sessions.

## Manual acceptance checklist (physical hardware)

1. Start charging, restart the backend, then publish the retained relay ON state.
   Confirm that the original process ID is reused, without a duplicate session.
2. Start charging, disconnect the broker and reconnect. Confirm that the session
   remains open and the next ON does not create a duplicate.
3. While disconnected, switch the physical relay OFF. After reconnect, deliver
   the relay OFF message and verify that the recovered process closes once.
4. Verify that no automatic OFF command is issued before relay confirmation.
5. Run an appliance cycle through a broker reconnect; verify that its in-memory
   process remains attached and the completion notification is not duplicated.
6. Compare actual Shelly readings with recorded charging history.

## Limitations

- The first relay message must reflect the current physical state. If the broker
  or device does not provide retained relay state, recovery remains pending
  until the next relay state message.
- A backend restart restores the newest open appliance cycle. Completion checks wait for fresh power telemetry; real MQTT hardware behavior still needs validation.
- Multiple already-open sessions for the same charger are not automatically
  closed; the newest open session is selected. Historical cleanup should be
  performed separately with an explicit reconciliation policy.
- Hardware and real MQTT broker behavior have not been tested in CI.

## Automated verification

Run the GitHub Actions backend and frontend jobs. The backend job includes
`node ../tests/test-mqtt-recovery.js`.
